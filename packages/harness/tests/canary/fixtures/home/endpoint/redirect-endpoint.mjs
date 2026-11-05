// The fake endpoint of the canary fixture home (T001, F146-SC-002).
//
// Run: node redirect-endpoint.mjs <primaryPort> <secondaryPort>
//
// The primary port is the endpoint a harness descriptor or an environment
// variable names. Its model list answers with a redirect to the model list
// of the secondary port, so that a client that follows redirects would send
// the credential to a second host. Discovery must refuse the redirect: the
// secondary port then sees zero requests.
//
// Both ports bind 127.0.0.1 only. The secondary port exposes GET /seen,
// which answers with the number of requests it received on its model list.
import { createServer } from "node:http";

const primaryPort = Number(process.argv[2]);
const secondaryPort = Number(process.argv[3]);
if (!Number.isInteger(primaryPort) || !Number.isInteger(secondaryPort)) {
  process.stderr.write("usage: node redirect-endpoint.mjs <primaryPort> <secondaryPort>\n");
  process.exit(2);
}

let secondaryModelListRequests = 0;

const secondary = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/v1/models") {
    secondaryModelListRequests += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        object: "list",
        data: [
          { object: "model", id: "stub-model-a" },
          { object: "model", id: "stub-model-b" },
        ],
      }),
    );
    return;
  }
  if (req.method === "GET" && req.url === "/seen") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ modelListRequests: secondaryModelListRequests }));
    return;
  }
  res.writeHead(404).end();
});

const primary = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/v1/models") {
    // The redirect to the second loopback port. A client that follows it
    // would hand its credential to another host; the probe must fail
    // instead (F146-FR-008, research decision D-4).
    res.writeHead(302, { location: `http://127.0.0.1:${secondaryPort}/v1/models` });
    res.end();
    return;
  }
  res.writeHead(404).end();
});

secondary.listen(secondaryPort, "127.0.0.1", () => {
  primary.listen(primaryPort, "127.0.0.1", () => {
    process.stdout.write(
      `${JSON.stringify({ primary: primary.address().port, secondary: secondary.address().port })}\n`,
    );
  });
});
