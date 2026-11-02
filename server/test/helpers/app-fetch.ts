import { once } from "node:events";
import { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { Duplex } from "node:stream";
import type { Express } from "express";

/**
 * Exercise the real Express routes and HTTP serialization without binding a port.
 * Set MANDATE_TEST_HTTP=socket to exercise localhost transport as well.
 * These merchant tests use GET requests with JSON responses, so no request body is needed.
 */
export async function appFetch(app: Express): Promise<{ base: string; fetch: typeof fetch; close: () => Promise<void> }> {
  if (process.env.MANDATE_TEST_HTTP === "socket") {
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening"); // rejects immediately on error, including sandbox EPERM
    return {
      base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      fetch,
      close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    };
  }

  const localFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.method !== "GET") throw new Error("appFetch supports GET requests only");
    const url = new URL(request.url);
    return new Promise<Response>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const socket = new Duplex({
        read() {},
        write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
      });
      socket.on("error", reject);
      const req = new IncomingMessage(socket as Socket);
      req.method = request.method;
      req.url = `${url.pathname}${url.search}`;
      req.headers = Object.fromEntries(request.headers);
      req.headers.host = url.host;
      req.httpVersion = "1.1";
      const res = new ServerResponse(req);
      res.useChunkedEncodingByDefault = false;
      res.shouldKeepAlive = false;
      res.assignSocket(socket as Socket);
      res.on("error", reject);
      res.on("finish", () => {
        const raw = Buffer.concat(chunks);
        const body = raw.subarray(raw.indexOf("\r\n\r\n") + 4);
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.getHeaders())) {
          if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
          else if (value !== undefined) headers.set(key, String(value));
        }
        resolve(new Response(body, { status: res.statusCode, headers }));
        socket.destroy();
      });
      app(req, res);
      req.push(null);
    });
  };
  return { base: "http://merchant.test", fetch: localFetch, close: async () => {} };
}
