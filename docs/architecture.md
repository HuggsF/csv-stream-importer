# Arquitetura e Engenharia de Solução — csv-stream-importer

> Documentação técnica detalhada do fluxo de ingestão massiva de dados, modelo de domínio e garantias de contenção de recursos.

---

## 1. Visão Geral do Pipeline de Dados

O diagrama abaixo ilustra o fluxo ponta a ponta desde a leitura física do arquivo CSV até a gravação final no MySQL 8 InnoDB, destacando os mecanismos de **Backpressure**, **Validação no Domínio**, **Tratamento de Duplicidades** e **Isolamento de Erros**.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"fontFamily": "Inter, Segoe UI, Helvetica, Arial, sans-serif", "fontSize": "15px", "lineColor": "#64748B", "primaryTextColor": "#0F172A", "clusterBkg": "#F8FAFC", "clusterBorder": "#CBD5E1", "titleColor": "#0F172A", "edgeLabelBackground": "#FFFFFF"}, "flowchart": {"curve": "basis", "nodeSpacing": 34, "rankSpacing": 40, "padding": 12, "wrappingWidth": 320}}}%%
flowchart TB
    CSV[("📄 students.csv · 500 mil linhas · 48 MB")]

    subgraph S1["① Ingestão via stream · ADR-001"]
        FS("fs.createReadStream → csv-parser<br/><i>blocos de 64 KB, lidos sob demanda</i>")
        LOOP{{"for await…of · uma linha por vez"}}
        FS --> LOOP
    end

    subgraph S2["② Validação no domínio · ADR-003"]
        CREATE[["Student.create(row)<br/><i>Email · StudentName · Score · data · curso</i>"]]
        VALID{{"Result‹Student›"}}
        CREATE --> VALID
    end

    subgraph S3["③ Lote e unicidade · ADR-002 · ADR-005"]
        BATCH("Buffer do lote · até 1.000 alunos")
        LOOKUP("findExistingEmails<br/><i>1 SELECT indexado … WHERE email IN (…)</i>")
        UNIQ{{"Unicidade · a primeira ocorrência vence"}}
        BATCH -->|"cheio ou EOF"| LOOKUP --> UNIQ
    end

    subgraph S4["④ Persistência · ADR-002"]
        INSERT("INSERT IGNORE … VALUES (…),(…)<br/><i>1 statement por lote · chaves UUID v7</i>")
        DB[("🗄️ MySQL 8 · InnoDB")]
        INSERT --> DB
    end

    subgraph S5["Relatório de erros"]
        REPORT("CsvErrorReportWriter<br/><i>em stream · protegido contra CSV injection</i>")
        ERRORS[("🧾 output/errors-‹timestamp›.csv")]
        REPORT --> ERRORS
    end

    CSV --> FS
    LOOP --> CREATE
    VALID -->|"✔ válida"| BATCH
    VALID -->|"✘ inválida"| REPORT
    UNIQ -->|"✔ única"| INSERT
    UNIQ -->|"✘ duplicada"| REPORT
    LOOP -.-|"⏸ aguarda cada flush · buffer do parser enche · o stream pausa"| INSERT

    classDef io fill:#E0F2FE,stroke:#0284C7,stroke-width:1.5px,color:#0C4A6E
    classDef domain fill:#EDE9FE,stroke:#7C3AED,stroke-width:1.5px,color:#2E1065
    classDef batch fill:#FEF3C7,stroke:#D97706,stroke-width:1.5px,color:#451A03
    classDef store fill:#DCFCE7,stroke:#16A34A,stroke-width:1.5px,color:#052E16
    classDef error fill:#FEE2E2,stroke:#DC2626,stroke-width:1.5px,color:#450A0A

    class CSV,FS,LOOP io
    class CREATE,VALID domain
    class BATCH,LOOKUP,UNIQ batch
    class INSERT,DB store
    class REPORT,ERRORS error

    style S1 fill:#F0F9FF,stroke:#7DD3FC,color:#0C4A6E
    style S2 fill:#F5F3FF,stroke:#C4B5FD,color:#2E1065
    style S3 fill:#FFFBEB,stroke:#FCD34D,color:#451A03
    style S4 fill:#F0FDF4,stroke:#86EFAC,color:#052E16
    style S5 fill:#FEF2F2,stroke:#FCA5A5,color:#450A0A

    linkStyle 8,10 stroke:#16A34A,stroke-width:2px
    linkStyle 9,11 stroke:#DC2626,stroke-width:2px
    linkStyle 12 stroke:#D97706,stroke-width:2px,stroke-dasharray:6 4
```

---

## 2. Diagrama de Sequência: Backpressure e I/O Assíncrono

O diagrama abaixo detalha a coordenação temporal e o controle de fluxo entre a leitura de disco, o Event Loop do Node.js e o banco de dados MySQL:

```mermaid
%%{init: {"theme": "base", "themeVariables": {"fontFamily": "Inter, Segoe UI, Helvetica, Arial, sans-serif", "fontSize": "15px", "actorBkg": "#EEF2FF", "actorBorder": "#6366F1", "actorTextColor": "#1E1B4B", "actorLineColor": "#94A3B8", "signalColor": "#475569", "signalTextColor": "#0F172A", "labelBoxBkgColor": "#F1F5F9", "labelBoxBorderColor": "#94A3B8", "labelTextColor": "#0F172A", "loopTextColor": "#334155", "noteBkgColor": "#FEF3C7", "noteBorderColor": "#D97706", "noteTextColor": "#451A03", "activationBkgColor": "#E0E7FF", "activationBorderColor": "#6366F1", "sequenceNumberColor": "#FFFFFF"}}}%%
sequenceDiagram
    autonumber
    actor U as 👤 CLI / job HTTP
    box rgb(240, 249, 255) Infraestrutura · leitura
        participant R as CsvParserStreamReader
    end
    box rgb(245, 243, 255) Núcleo · Application + Domain
        participant UC as ImportStudentsUseCase
        participant D as Student.create
    end
    box rgb(240, 253, 244) Infraestrutura · persistência
        participant Repo as MySqlStudentRepository
        participant DB as MySQL 8
    end
    box rgb(254, 242, 242) Infraestrutura · auditoria
        participant E as Relatório de erros
    end

    U->>+UC: execute({ filePath, batchSize: 1000 })
    UC->>R: read(filePath)
    Note over R: createReadStream → csv-parser<br/>lê blocos de 64 KB só quando há demanda

    loop for await…of — uma linha por vez
        R-->>UC: { lineNumber, name, email, … }
        UC->>D: Student.create(row)
        alt linha válida
            D-->>UC: ok(Student)
            UC->>UC: batch.push(student)
        else linha inválida
            D-->>UC: fail(InvalidStudentError)
            UC-)E: write() · 1 linha por campo inválido
        end

        opt batch.length = 1.000
            rect rgb(255, 251, 235)
                Note over R,UC: BACKPRESSURE · o loop aguarda o flush, o buffer do parser<br/>atinge o highWaterMark e o fs stream para de ler o disco
                UC->>+Repo: findExistingEmails(1.000 e-mails)
                Repo->>DB: SELECT email … WHERE email IN (…)
                DB-->>Repo: e-mails já cadastrados
                Repo-->>-UC: Set‹email›
                UC->>UC: StudentUniquenessService.partition()
                UC-)E: duplicados → relatório
                UC->>+Repo: bulkInsert(únicos)
                Repo->>DB: INSERT IGNORE … VALUES (…), (…)
                DB-->>Repo: affectedRows
                Repo-->>-UC: linhas inseridas
                Note over R,UC: Promise resolvida · o loop volta a puxar linhas e o stream retoma
            end
        end
    end

    UC->>Repo: flush do lote residual (EOF)
    UC-->>-U: ImportStudentsOutput · processadas, importadas, rejeitadas, duração, pico de memória
```

---

## 3. Arquitetura em Camadas (Clean Architecture & DDD)

O projeto segue estritamente os princípios da **Clean Architecture** e **Domain-Driven Design**. As dependências apontam exclusivamente para o centro (Domain), regra validada em tempo de compilação e garantida pelo ESLint (`no-restricted-imports`):

```mermaid
%%{init: {"theme": "base", "themeVariables": {"fontFamily": "Inter, Segoe UI, Helvetica, Arial, sans-serif", "fontSize": "15px", "lineColor": "#64748B", "primaryTextColor": "#0F172A", "clusterBkg": "#F8FAFC", "clusterBorder": "#CBD5E1", "titleColor": "#0F172A", "edgeLabelBackground": "#FFFFFF"}, "flowchart": {"curve": "basis", "nodeSpacing": 30, "rankSpacing": 60, "padding": 14, "wrappingWidth": 260}}}%%
flowchart LR
    subgraph IN["🚪 Presentation · adaptadores de entrada"]
        direction TB
        CLI("CLI · commander<br/><i>import · migrate</i>")
        HTTP("HTTP · Express 5<br/><i>upload · status do job · /health</i>")
    end

    subgraph APP["⚙️ Application · casos de uso"]
        direction TB
        UC1("ImportStudentsUseCase")
        UC2("Start / ProcessImportJobUseCase")
        UC3("GetImportJobStatus · CheckHealth")
    end

    subgraph CORE["💎 Domain · zero dependências"]
        direction TB
        D1["Student · ImportJob"]
        D2["Email · StudentName · Score · FilePath"]
        D3["StudentUniquenessService"]
        D4["Result‹T, E› · DomainError"]
    end

    subgraph PORTS["🔌 Ports · interfaces definidas pelo núcleo"]
        direction TB
        P1["StudentRepository"]
        P2["CsvStreamReader"]
        P3["ErrorReportWriter"]
        P4["ImportJobQueue"]
        P5["Logger · Clock · IdGenerator"]
    end

    subgraph OUT["🔧 Infrastructure · adaptadores de saída"]
        direction TB
        A1("MySqlStudentRepository<br/><i>knex · mysql2</i>")
        A2("CsvParserStreamReader<br/><i>fs streams · csv-parser</i>")
        A3("CsvErrorReportWriter<br/><i>CSV em stream</i>")
        A4("InProcessImportJobQueue<br/><i>concorrência limitada</i>")
        A5("pino · SystemClock · UUID v7")
    end

    CLI --> UC1
    HTTP --> UC2
    HTTP --> UC3
    APP ==>|usa| CORE
    APP -->|depende de| PORTS
    P1 -.-|implementado por| A1
    P2 -.- A2
    P3 -.- A3
    P4 -.- A4
    P5 -.- A5

    classDef pres fill:#E0F2FE,stroke:#0284C7,stroke-width:1.5px,color:#0C4A6E
    classDef app fill:#DCFCE7,stroke:#16A34A,stroke-width:1.5px,color:#052E16
    classDef dom fill:#EDE9FE,stroke:#7C3AED,stroke-width:1.5px,color:#2E1065
    classDef port fill:#FFFFFF,stroke:#7C3AED,stroke-width:1.5px,stroke-dasharray:4 3,color:#2E1065
    classDef infra fill:#FEF3C7,stroke:#D97706,stroke-width:1.5px,color:#451A03

    class CLI,HTTP pres
    class UC1,UC2,UC3 app
    class D1,D2,D3,D4 dom
    class P1,P2,P3,P4,P5 port
    class A1,A2,A3,A4,A5 infra

    style IN fill:#F0F9FF,stroke:#7DD3FC,color:#0C4A6E
    style APP fill:#F0FDF4,stroke:#86EFAC,color:#052E16
    style CORE fill:#F5F3FF,stroke:#C4B5FD,color:#2E1065
    style PORTS fill:#FAF5FF,stroke:#D8B4FE,color:#2E1065
    style OUT fill:#FFFBEB,stroke:#FCD34D,color:#451A03
```

---

## 4. Ciclo de Vida do Job de Importação (API HTTP)

Uploads recebidos em `POST /api/import` viram um `ImportJob` processado em background por uma fila em processo com concorrência e backlog limitados. As transições são invariantes da entidade — transições inválidas retornam `InvalidImportJobTransitionError`:

```mermaid
%%{init: {"theme": "base", "themeVariables": {"fontFamily": "Inter, Segoe UI, Helvetica, Arial, sans-serif", "fontSize": "15px", "lineColor": "#64748B", "primaryColor": "#E0F2FE", "primaryBorderColor": "#0284C7", "primaryTextColor": "#0C4A6E", "edgeLabelBackground": "#FFFFFF", "transitionLabelColor": "#334155"}}}%%
stateDiagram-v2
    direction LR
    [*] --> pending: POST /api/import → 202
    pending --> processing: a fila inicia o job
    pending --> failed: fila cheia · shutdown
    processing --> completed: relatório gerado
    processing --> failed: falha de infraestrutura
    completed --> [*]
    failed --> [*]

    classDef waiting fill:#FEF3C7,stroke:#D97706,stroke-width:1.5px,color:#451A03
    classDef running fill:#E0F2FE,stroke:#0284C7,stroke-width:1.5px,color:#0C4A6E
    classDef ok fill:#DCFCE7,stroke:#16A34A,stroke-width:1.5px,color:#052E16
    classDef ko fill:#FEE2E2,stroke:#DC2626,stroke-width:1.5px,color:#450A0A

    class pending waiting
    class processing running
    class completed ok
    class failed ko
```

| Transição | Quem dispara |
|---|---|
| `pending → processing` | `InProcessImportJobQueue` inicia o `ProcessImportJobUseCase` |
| `pending → failed` | fila cheia (`503` + `Retry-After`), ou shutdown antes do início |
| `processing → completed` | importação concluída (inclusive abortada por `SIGTERM` após o lote corrente) |
| `processing → failed` | falha de infraestrutura (MySQL fora do ar, stream corrompido…) |

---

## 5. Garantias de Performance e Recursos

| Mecanismo | Problema Evitado | Garantia Técnica |
|---|---|---|
| **Backpressure Automático** | Out of Memory (OOM) | O consumo do stream é suspenso enquanto a Promise de inserção no MySQL é resolvida. O arquivo só é lido conforme o banco consegue gravar. |
| **Memória $O(\text{batch})$** | Alocação linear com o tamanho do arquivo | A memória não cresce com o tamanho do arquivo: na importação de 500 mil linhas o pico foi de **78,7 MB RSS**, com heap vivo de ~16 MB (medido com GC forçado — [ADR-004](adr/004-memory-budget-and-heap-tuning.md)). |
| **Bulk INSERT (1.000 linhas)** | 500.000 round-trips e gargalo de rede | ~500 INSERTs em lote (+ ~500 SELECTs de unicidade) no lugar de 500.000 statements, atingindo **8.470 linhas/segundo**. |
| **UUID v7 (RFC 9562)** | Page splits e fragmentação no InnoDB | IDs com prefixo temporal de 48 bits são inseridos em ordem crescente no fim da árvore B+ do índice clusterizado, reduzindo page splits em relação ao UUID v4 aleatório (`npm run benchmark:uuid`). |
| **Isolamento de Erros via Stream** | Falhas silenciosas e injeção de fórmulas | Linhas rejeitadas são descarregadas em disco linha a linha no formato CSV, com escape contra CSV Injection para caracteres perigosos (`=`, `+`, `-`, `@`). |
