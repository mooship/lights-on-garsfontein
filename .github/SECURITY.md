# Security policy

## Reporting a vulnerability

Report it privately through [GitHub's private vulnerability reporting](https://github.com/mooship/lights-on-garsfontein/security/advisories/new). Please do not open a public issue for a security problem.

This is a one-person, unpaid project, so replies are best effort. There is no bug bounty.

## Scope

- The site at https://garsfontein.timothybrits.co.za and its API (`/api/*`, the feed and the CSV).
- The code in this repository, including the Worker, the app and the sensor script (`scripts/mac-sensor.sh`).

Cloudflare's own services and the third-party pages the site links to are out of scope.

## Testing

Please test only against your own deployment or a local copy (`npm run dev:worker`). Against the live site, do not:

- load test it, flood it or try to get round its rate limits;
- try passwords or tokens against the sign-in form or the sensor endpoints;
- read, change or delete outage records, or access anyone's data but your own.

Good-faith research that keeps to these limits is welcome, and I will not pursue it.
