import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import {
  activationDescriptor,
  httpIdleConfiguration,
} from "../deploy/scripts/http-idle-server.mjs";

it("validates idle settings and activation identity without changing development defaults", () => {
  expect(httpIdleConfiguration({})).toEqual({
    enabled: true,
    timeoutMs: 900_000,
  });
  expect(
    httpIdleConfiguration({
      HTTP_IDLE_ENABLED: "false",
      HTTP_IDLE_TIMEOUT_SECONDS: "30",
    }),
  ).toEqual({ enabled: false, timeoutMs: 30_000 });
  for (const value of [
    "",
    "0",
    "1",
    "29",
    "86401",
    "900.0",
    " 900",
    "Infinity",
  ])
    expect(() =>
      httpIdleConfiguration({ HTTP_IDLE_TIMEOUT_SECONDS: value }),
    ).toThrow();
  expect(() => httpIdleConfiguration({ HTTP_IDLE_ENABLED: "yes" })).toThrow();
  expect(activationDescriptor({})).toBeUndefined();
  for (const env of [
    { LISTEN_PID: "1", LISTEN_FDS: "1" },
    { LISTEN_PID: String(process.pid), LISTEN_FDS: "2" },
    {
      LISTEN_PID: String(process.pid),
      LISTEN_FDS: "1",
      LISTEN_FDNAMES: "wrong",
    },
  ])
    expect(() => activationDescriptor(env)).toThrow(/identity/);
});

it.skipIf(process.platform === "win32")(
  "retains the listener across process exits and drains requests, streams and uploads",
  () => {
    execFileSync(
      "python3",
      [
        "-c",
        String.raw`
import socket,subprocess,sys,time,http.client,os
listener=socket.socket();assert listener.fileno()==3
listener.bind(('127.0.0.1',0));listener.listen(64);port=listener.getsockname()[1]
fixture=os.path.abspath('deploy/ci/http-idle-fixture.mjs')
def start(mode='activated',expected=port):
 return subprocess.Popen([sys.argv[1],fixture,str(expected),mode],pass_fds=(3,),stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
def request(path='/',data=None):
 c=http.client.HTTPConnection('127.0.0.1',port,timeout=5)
 try:
  c.request('GET'if data is None else'POST',path,body=data);r=c.getresponse();assert r.status==200;return r.read()
 finally:c.close()
p=None
try:
 p=start();assert request()==b'ok';p.wait(timeout=5);assert p.returncode==0
 # A request queued before the next process starts remains on the listener.
 c=socket.create_connection(('127.0.0.1',port));c.sendall(b'GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n')
 p=start();c.settimeout(5);body=b''
 while True:
  b=c.recv(4096)
  if not b:break
  body+=b
 c.close();assert body.endswith(b'ok');p.wait(timeout=5);assert p.returncode==0
 for path in ['/delay','/stream']:
  p=start();value=request(path);assert b'complete'in value;p.wait(timeout=5);assert p.returncode==0
 p=start();c=socket.create_connection(('127.0.0.1',port));c.sendall(b'POST /upload HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\nConnection: close\r\n\r\na');time.sleep(.5)
 assert p.poll()is None;c.sendall(b'b');c.settimeout(5);body=b''
 while True:
  b=c.recv(4096)
  if not b:break
  body+=b
 c.close();assert body.endswith(b'uploaded');p.wait(timeout=5);assert p.returncode==0
 p=start('lease');assert request()==b'ok';time.sleep(.3);assert p.poll()is None;p.wait(timeout=5)
 # Disconnecting a client must not close the listener while its handler is
 # still completing asynchronous work and finally blocks.
 p=start();c=socket.create_connection(('127.0.0.1',port));c.sendall(b'GET /abandoned HTTP/1.1\r\nHost: localhost\r\n\r\n');time.sleep(.1);c.close();time.sleep(.3)
 assert request('/health')==b'ok';p.wait(timeout=5);assert p.returncode==0
 # Readiness polls do not extend the real-request idle deadline.
 p=start();assert request()==b'ok';began=time.monotonic()
 while p.poll()is None and time.monotonic()-began<.12:
  assert request('/health')==b'ok';time.sleep(.02)
 p.wait(timeout=5);assert p.returncode==0
 # Exercise Hono's actual HTTP adaptor and the stateless MCP SDK. They must
 # not retain background timers after the inherited listener is closed.
 p=start('mcp');c=http.client.HTTPConnection('127.0.0.1',port,timeout=5)
 c.request('POST','/mcp',body='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"fixture","version":"1"}}}',headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream'})
 r=c.getresponse();assert r.status==200;assert b'protocolVersion'in r.read();c.close();p.wait(timeout=5);assert p.returncode==0
 p=start('disabled');assert request()==b'ok';time.sleep(.3);assert p.poll()is None;p.terminate();p.wait(timeout=5)
 p=start(expected=port+1 if port<65535 else port-1);p.wait(timeout=5);assert p.returncode!=0
finally:
 if p and p.poll()is None:p.kill();p.wait()
 listener.close()
`,
        process.execPath,
      ],
      { timeout: 20_000, stdio: "pipe" },
    );
  },
);
