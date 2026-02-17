# Conferir uso de índices no dashboard de Simulações

## 1. Atualizar estatísticas (obrigatório após criar índices)

O planner só usa índices de forma correta se as estatísticas estiverem atualizadas:

```bash
psql -U seu_usuario -d sua_base -f script-bi/sql/analyze_freight_tables.sql
```

Ou no cliente SQL:

```sql
ANALYZE freight_quotes;
ANALYZE freight_quotes_items;
ANALYZE freight_quote_options;
ANALYZE freight_orders;
ANALYZE companies;
ANALYZE products;
```

---

## 2. Ver o plano de execução (está usando índice ou não?)

Abra `explain_dashboard_simulations.sql`, **troque** no arquivo:

- `1` pelo `company_id` real da company que você está testando
- `'2026-02-01'` e `'2026-02-16'` pelo período de 15 dias que você usa

Depois execute cada bloco **EXPLAIN (ANALYZE, BUFFERS, ...)** no psql ou no DBeaver.

### O que procurar no resultado

| No plano                         | Significado |
|----------------------------------|-------------|
| **Index Scan using idx_freight_quotes_company_quoted_at** | Bom: está usando o índice em `freight_quotes`. |
| **Index Scan using idx_freight_orders_quote_id**         | Bom: lookup em `freight_orders` por quote.    |
| **Seq Scan on freight_quotes**                           | Ruim: full table scan (tabela grande = lento). |
| **Nested Loop** com **Index Scan** nos filhos            | Bom: join usando índices.                     |
| **Buffers: shared hit=XXX**                              | Dados em memória (rápido).                    |
| **Buffers: shared read=XXX**                             | Leitura em disco (mais lento).                |
| **Execution Time: XX ms** (no final)                     | Tempo real da query.                          |

Se aparecer **Seq Scan** em `freight_quotes` ou `freight_orders` para período de 15 dias e 1 company, normalmente é sinal de estatísticas desatualizadas ou de o planner achar que a tabela é “pequena” e preferir seq scan. Veja a seção 5.

---

## 3. Forçar uso de índice no PostgreSQL (só para teste)

PostgreSQL **não** tem hint tipo “USE INDEX” como no MySQL. Duas formas de “forçar” uso de índice (apenas para diagnóstico):

### Opção A: Desligar seq scan na sessão (teste rápido)

Na **mesma sessão** onde você roda a query:

```sql
SET enable_seqscan = off;
```

Depois rode a query do dashboard (ou o EXPLAIN ANALYZE). O planner tende a preferir Index Scan. **Não deixe isso ligado em produção**: pode piorar outras queries. Para voltar:

```sql
SET enable_seqscan = on;
```

### Opção B: Ajustar custos (teste em dev/staging)

Se o disco for SSD, index scan pode ser subestimado. Na sessão:

```sql
SET random_page_cost = 1.1;   -- default 4.0; menor = índice mais atraente
SET enable_seqscan = off;     -- só para teste
```

Rode a query, veja se passa a usar índice e o tempo. Em produção, `random_page_cost` pode ser configurado no `postgresql.conf` (ex.: 1.1 para SSD), sem precisar de `enable_seqscan = off`.

---

## 4. Índice covering para daily (index-only scan + sem sort)

O índice **idx_freight_quotes_daily_agg** em `(company_id, ((quoted_at AT TIME ZONE 'UTC')::date)) INCLUDE (quote_id)` foi criado para a CTE de quotes da rota daily (o cast direto `quoted_at::date` não é IMMUTABLE; AT TIME ZONE 'UTC' torna a expressão imutável):

- O planner pode usar **Index Only Scan** (não lê o heap → evita os ~64 s de Bitmap Heap Scan).
- As linhas já vêm ordenadas por dia → **GroupAggregate sem Sort** (evita os ~66 s de external merge).

**Depois de criar o índice**, rode **VACUUM ANALYZE freight_quotes** (ou o script `index_freight_quotes_daily_agg.sql`) para que o index-only scan seja usado. A API passou a usar `(quoted_at AT TIME ZONE 'UTC')::date BETWEEN $2 AND $3` na CTE quotes para casar com esse índice (datas em UTC).

---

## 5. Query daily reescrita (menos memória e sort)

A rota **simulations/daily** foi reescrita para:

- **quotes**: agregar direto com `GROUP BY fq.quoted_at::date` (saída ~16 linhas em vez de 845k).
- **orders**: usar `EXISTS (SELECT 1 FROM freight_quotes WHERE quote_id = fo.quote_id AND ...)` em vez de `JOIN base_quotes` (evita materializar 845k linhas e o sort em disco).

Assim, mesmo com Seq Scan em `freight_quotes`, o tempo deve cair bastante (sem sort de 845k linhas). Para tentar que o planner use o índice em `freight_quotes`, rode `stats_freight_quotes.sql` e depois `ANALYZE freight_quotes`.

---

## 6. Se ainda estiver Seq Scan em `freight_quotes` (15 dias, 1 company)

Possíveis causas e o que fazer:

1. **Estatísticas antigas**  
   Rodar de novo: `analyze_freight_tables.sql` (ou `ANALYZE` nas tabelas acima).

2. **Condição com cast**  
   A API usa `fq.quoted_at::date BETWEEN $2::date AND $3::date`. Em alguns casos o planner não usa bem o índice nesse cast. Uma alternativa é mudar na API para intervalo em `timestamptz`:
   - `quoted_at >= $2::timestamptz AND quoted_at < ($3::date + interval '1 day')::timestamptz`
   Assim o índice em `(company_id, quoted_at)` é usado de forma direta.

3. **Uso de group_id em vez de company_id**  
   Quando o filtro é por **grupo** (`c.group_id = $1`), o planner pode fazer: busca companies do grupo e depois busca quotes por cada `company_id`. Os índices em `companies(group_id)` e `freight_quotes(company_id, quoted_at)` ajudam; garantir que `ANALYZE` foi rodado em ambas as tabelas.

4. **Tabela pequena**  
   Se a tabela tiver poucas linhas, o planner pode escolher Seq Scan de propósito (pode ser mais barato). Para 15 dias e 1 company “grande”, normalmente Index Scan deve ser escolhido após `ANALYZE`.

5. **Mais estatísticas**  
   Rode `script-bi/sql/stats_freight_quotes.sql` (aumenta STATISTICS em `company_id` e `quoted_at`) e depois `ANALYZE freight_quotes`. Isso pode fazer o planner preferir Index Scan.

---

## 7. Resumo rápido

1. Rodar **analyze_freight_tables.sql**.
2. Rodar **explain_dashboard_simulations.sql** (com company_id e datas reais) e ver se aparece **Index Scan** em `freight_quotes` e `freight_orders`.
3. Se não aparecer: na mesma sessão, `SET enable_seqscan = off;` e rodar de novo; se com isso passar a usar índice e ficar rápido, o problema é escolha do planner (estatísticas ou custos).
4. Considerar trocar na API o filtro de data para intervalo em `timestamptz` (já feito) para garantir uso do índice em `quoted_at`.
5. Criar índice **idx_freight_quotes_daily_agg** (ver `index_freight_quotes_daily_agg.sql`) e rodar **VACUUM ANALYZE freight_quotes** para a daily usar index-only scan e evitar sort.
6. Query daily já reescrita (agregação por dia + EXISTS); filtro em quotes usa `quoted_at::date BETWEEN` para usar o índice covering.
