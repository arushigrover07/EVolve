| Configuration | Tool and version | Client HTTP requests | Concurrency | Failed HTTP requests | Total duration (s) | Requests per second | Mean HTTP response time (ms) | Backend attempts | Database statements | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| One backend via isolated Nginx, port 5174 | | | | | | | | | | |
| Three backends via benchmark Nginx, port 5173 | | | | | | | | | | |

RPS improvement (%):

Mean response-time reduction (%):

All measurements remain blank until accepted runs exist. Backend attempts and
SQL statements are unmeasured; record them as unmeasured, never infer 1000 from
client counts. Retain negative improvements. Record image/workload/tool hashes,
raw artifact locations, pool limits, warmness/cache state, order and other traffic
in the run notes. A zero baseline mean makes percentage reduction undefined.
