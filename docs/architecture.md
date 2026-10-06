# Arquitetura e Engenharia de Solução — csv-stream-importer

> Documentação técnica detalhada do fluxo de ingestão massiva de dados, modelo de domínio e garantias de contenção de recursos.

---

## 1. Visão Geral do Pipeline de Dados

O diagrama abaixo ilustra o fluxo ponta a ponta desde a leitura física do arquivo CSV até a gravação final no MySQL 8 InnoDB, destacando os mecanismos de **Backpressure**, **Validação no Domínio**, **Tratamento de Duplicidades** e **Isolamento de Erros**.

```mermaid
flowchart TD
    subgraph INGESTION["1. Stream Ingestion & Backpressure"]
        CSV["📄 data/students.csv<br/>(500k rows / 48 MB)"]
        FS["🌊 fs.createReadStream()<br/>(Chunks de 64 KB sob demanda)"]
        PARSER["⚙️ csv-parser (Transform Stream)<br/>(BOM, CRLF & aspas normalizados)"]
        LOOP{"🔄 for await...of Loop<br/>(Backpressure Reativo)"}
    end

    subgraph DOMAIN["2. Domain Boundary & Validation"]
        CREATE["🏛️ Student.create(row)<br/>Domain Entity & Value Objects"]
        VO_EMAIL["✉️ Email (Normalizado & Validado)"]
        VO_NAME["👤 StudentName (2-100 chars)"]
        VO_SCORE["📊 Score (0-100, 2 casas)"]
        RESULT{"⚖️ Result&lt;Student, DomainError&gt;"}
    end

    subgraph ERROR_PIPELINE["3. Auditoria & Isolamento de Erros"]
        ERR_WRITER["📝 CsvErrorReportWriter<br/>(Stream seguro contra CSV-injection)"]
        ERR_FILE[("🛑 output/errors-timestamp.csv<br/>(Linha, Campo, Valor, Motivo)")]
    end

    subgraph BATCHING["4. Acumulação em Lote & Unicidade"]
        BUFFER["📦 Buffer em Memória<br/>(Lote delimitado: 1.000 alunos)"]
        UNIQ["🔍 StudentUniquenessService<br/>SELECT email FROM students WHERE email IN (...)"]
        SPLIT{"Checagem de Duplicidade"}
    end

    subgraph PERSISTENCE["5. MySQL 8 Storage Engine"]
        BULK["🚀 Bulk INSERT IGNORE<br/>UUID v7 Primary Keys (Append-only)"]
        INNODB[("🗄️ MySQL 8 InnoDB<br/>Clustered Index B+ Tree")]
    end

    CSV --> FS
    FS -->|Chunks de 64 KB| PARSER
    PARSER -->|Async Iterable| LOOP
    LOOP --> CREATE
    CREATE -.-> VO_EMAIL & VO_NAME & VO_SCORE
    CREATE --> RESULT

    RESULT -->|❌ Linha Inválida| ERR_WRITER
    ERR_WRITER --> ERR_FILE

    RESULT -->|✅ Aluno Válido| BUFFER
    BUFFER -->|Lote de 1.000 ou Fim do Arquivo| UNIQ
    UNIQ --> SPLIT

    SPLIT -->|❌ Duplicado no arquivo ou banco| ERR_WRITER
    SPLIT -->|✅ Alunos Únicos| BULK
    BULK --> INNODB

    BULK -.->|await Promise resolve<br/>Retoma leitura do stream| LOOP

    classDef source fill:#1e293b,stroke:#3b82f6,stroke-width:2px,color:#f8fafc;
    classDef domain fill:#0f172a,stroke:#8b5cf6,stroke-width:2px,color:#f8fafc;
    classDef error fill:#450a0a,stroke:#ef4444,stroke-width:2px,color:#fca5a5;
    classDef batch fill:#1e1b4b,stroke:#06b6d4,stroke-width:2px,color:#f8fafc;
    classDef storage fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#d1fae5;

    class CSV,FS,PARSER,LOOP source;
    class CREATE,VO_EMAIL,VO_NAME,VO_SCORE,RESULT domain;
    class ERR_WRITER,ERR_FILE error;
    class BUFFER,UNIQ,SPLIT batch;
    class BULK,INNODB storage;
```

---

## 2. Diagrama de Sequência: Backpressure e I/O Assíncrono

O diagrama abaixo detalha a coordenação temporal e o controle de fluxo entre a leitura de disco, o Event Loop do Node.js e o banco de dados MySQL:

```mermaid
sequenceDiagram
    autonumber
    actor CLI as Usuário / CLI
    participant FS as fs.createReadStream
    participant Parser as csv-parser (Transform)
    participant UC as ImportStudentsUseCase
    participant Domain as Student (Domain)
    participant Repo as MySqlStudentRepository
    participant DB as MySQL 8 InnoDB

    CLI->>UC: execute({ filePath, batchSize: 1000 })
    UC->>FS: Inicia leitura (64 KB chunks)
    FS->>Parser: Pipe chunks de bytes
    Parser-->>UC: Emite linhas parseadas (Async Iterable)

    loop Para cada linha do CSV
        UC->>Domain: Student.create(row)
        alt Linha Válida
            Domain-->>UC: Result.ok(Student)
            UC->>UC: batch.push(Student)
        else Linha Inválida
            Domain-->>UC: Result.fail(DomainError)
            UC->>UC: reportWriter.writeError(line, error)
        end

        opt Quando batch.length === 1000
            Note over UC,FS: BACKPRESSURE ATIVADO: Loop assíncrono aguarda I/O.<br/>O buffer do parser atinge highWaterMark e o fs stream pausa.
            UC->>Repo: findExistingEmails(batchEmails)
            Repo->>DB: SELECT email FROM students WHERE email IN (...)
            DB-->>Repo: Emails já registrados
            Repo-->>UC: Set com emails existentes
            UC->>UC: Particiona lote (identifica duplicados)
            UC->>Repo: bulkInsert(validBatch)
            Repo->>DB: INSERT IGNORE INTO students VALUES (... 1.000 linhas ...)
            DB-->>Repo: affectedRows: 1000
            Repo-->>UC: Confirma inserção
            UC->>UC: batch.clear()
            Note over UC,FS: BACKPRESSURE LIBERADO: Promise resolvida.<br/>O stream volta a ler mais 64 KB do disco.
        end
    end

    opt Lote Residual (< 1.000 linhas no EOF)
        UC->>Repo: bulkInsert(residualBatch)
        Repo->>DB: INSERT IGNORE INTO students VALUES (...)
    end

    UC-->>CLI: ImportStudentsOutput (total, importados, rejeitados, duração, memória)
```

---

## 3. Arquitetura em Camadas (Clean Architecture & DDD)

O projeto segue estritamente os princípios da **Clean Architecture** e **Domain-Driven Design**. As dependências apontam exclusivamente para o centro (Domain), regra validada em tempo de compilação e garantida pelo ESLint (`no-restricted-imports`):

```mermaid
graph TD
    subgraph PRESENTATION["Presentation Layer"]
        CLI["CLI (Commander)<br/>import, migrate"]
        HTTP["HTTP API (Express 5)<br/>POST /api/import, /health"]
    end

    subgraph INFRASTRUCTURE["Infrastructure Layer"]
        DB_REPO["MySqlStudentRepository<br/>(Knex / mysql2)"]
        CSV_READER["CsvParserStreamReader<br/>(Streams / Pipeline)"]
        REPORT_WRITER["CsvErrorReportWriter<br/>(Escrita segura em disco)"]
        PINO_LOG["Pino Logger<br/>(JSON estruturado)"]
        QUEUE["InProcessImportJobQueue<br/>(Concorrência limitada)"]
    end

    subgraph APPLICATION["Application Layer (Use Cases & Ports)"]
        UC_IMPORT["ImportStudentsUseCase"]
        UC_JOB["Start / ProcessImportJobUseCase"]
        PORTS_REPO["StudentRepository (Port)"]
        PORTS_CSV["CsvStreamReader (Port)"]
        PORTS_WRITER["ErrorReportWriter (Port)"]
    end

    subgraph DOMAIN["Domain Layer (Zero Dependências)"]
        ENTITY["Entities: Student, ImportJob"]
        VO["Value Objects: Email, StudentName, Score, FilePath"]
        SERVICE["Services: StudentUniquenessService"]
        RESULT["Shared: Result&lt;T, E&gt;"]
        ERRORS["DomainError Hierarchy"]
    end

    CLI --> UC_IMPORT
    HTTP --> UC_JOB
    UC_IMPORT --> PORTS_REPO
    UC_IMPORT --> PORTS_CSV
    UC_IMPORT --> PORTS_WRITER
    UC_IMPORT --> DOMAIN
    UC_JOB --> DOMAIN

    DB_REPO -.->|Implementa| PORTS_REPO
    CSV_READER -.->|Implementa| PORTS_CSV
    REPORT_WRITER -.->|Implementa| PORTS_WRITER

    classDef pres fill:#1e293b,stroke:#3b82f6,stroke-width:2px,color:#f8fafc;
    classDef infra fill:#1f2937,stroke:#f59e0b,stroke-width:2px,color:#f8fafc;
    classDef app fill:#111827,stroke:#10b981,stroke-width:2px,color:#f8fafc;
    classDef dom fill:#030712,stroke:#8b5cf6,stroke-width:2px,color:#f8fafc;

    class CLI,HTTP pres;
    class DB_REPO,CSV_READER,REPORT_WRITER,PINO_LOG,QUEUE infra;
    class UC_IMPORT,UC_JOB,PORTS_REPO,PORTS_CSV,PORTS_WRITER app;
    class ENTITY,VO,SERVICE,RESULT,ERRORS dom;
```

---

## 4. Garantias de Performance e Recursos

| Mecanismo | Problema Evitado | Garantia Técnica |
|---|---|---|
| **Backpressure Automático** | Out of Memory (OOM) | O consumo do stream é suspenso enquanto a Promise de inserção no MySQL é resolvida. O arquivo só é lido conforme o banco consegue gravar. |
| **Memória $O(\text{batch})$** | Alocação linear com o tamanho do arquivo | A memória utilizada permanece estável em **~78 MB RSS** (heap ativo de ~16 MB), seja para 100 linhas ou 50.000.000 de linhas. |
| **Bulk INSERT (1.000 linhas)** | 500.000 round-trips e gargalo de rede | Reduz os round-trips em 99.9% (~500 statements no total) atingindo taxa de **8.470 linhas/segundo**. |
| **UUID v7 (RFC 9562)** | Page Splitting e fragmentação no InnoDB | IDs gerados com prefixo temporal de 48 bits resultam em append sequencial na ponta da árvore B+, mantendo alto índice de ocupação de página e eliminando rebalanceamento. |
| **Isolamento de Erros via Stream** | Falhas silenciosas e injeção de fórmulas | Linhas rejeitadas são descarregadas em disco linha a linha no formato CSV, com escape contra CSV Injection para caracteres perigosos (`=`, `+`, `-`, `@`). |
