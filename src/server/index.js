import http from "node:http";
import { createServerContext } from "./config.js";
import { createRequestHandler } from "./routes.js";

const context = await createServerContext();
const server = http.createServer(createRequestHandler(context));

server.listen(context.port, () => {
  console.log(`Sable terminal running at http://localhost:${context.port}`);
});
