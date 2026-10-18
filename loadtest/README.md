# Load testing

## Run the demo (all API instances up)
```powershell
docker compose up -d
k6 run loadtest/search.js
```
`search.js` ramps up to 50 concurrent virtual users hitting `/books/search`
through Nginx on port 8080. Watch the summary at the end: `http_req_failed`
should stay under 5% and `p(95)` under 1 second.

## Resilience demo (kill an instance mid-test)
In one terminal:
```powershell
k6 run loadtest/search.js
```
While it's running, in a second terminal:
```powershell
docker stop lib_api2
```
The test should keep passing - Nginx routes traffic to api1 and api3 instead.
Watch `docker compose logs -f nginx` in a third terminal to see the
`upstream=` field switch away from api2.

Bring it back with `docker start lib_api2`.
