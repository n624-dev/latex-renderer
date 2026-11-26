import { describe, expect, it, vi } from "vitest";
import { ConnectedAgents } from "../apps/public-mcp-gateway/src/agent-channels.js";
import type { ConnectionTransport } from "../apps/public-mcp-gateway/src/connections.js";

const agent = {
  instanceId: "instance-a",
  publicKey: "agent-key",
  transportId: "transport-a",
};

function fixture() {
  const transport: ConnectionTransport = {
    id: agent.transportId,
    instanceId: agent.instanceId,
    endpoint: { kind: "agent", publicKey: agent.publicKey },
    disabledAt: null,
  };
  const agents = new ConnectedAgents({
    transport: (id) => (id === transport.id ? transport : undefined),
  });
  return { transport, agents };
}

describe("separate control and file channels", () => {
  it("keeps control available when the file channel goes offline", () => {
    const { agents } = fixture();
    const control = { close: vi.fn() },
      data = { close: vi.fn() };
    const generation = agents.attachControl(agent, control) ?? "invalid";
    expect(agents.attachFiles(agent, generation, data)).toBe(true);
    expect(agents.files(agent.transportId, generation)).toBe(data);
    agents.detachFiles(agent.transportId, generation, data);
    expect(agents.files(agent.transportId, generation)).toBeUndefined();
    expect(agents.control(agent.transportId)).toBe(control);
    expect(control.close).not.toHaveBeenCalled();
  });

  it("closes stale channels and rejects a file connection from an old generation or another identity", () => {
    const { agents } = fixture();
    const first = { close: vi.fn() },
      data = { close: vi.fn() },
      current = { close: vi.fn() };
    const generation = agents.attachControl(agent, first) ?? "invalid";
    expect(agents.attachFiles(agent, generation, data)).toBe(true);
    const next = agents.attachControl(agent, current) ?? "invalid";
    expect(next).not.toBe(generation);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(data.close).toHaveBeenCalledTimes(1);
    agents.detachControl(agent.transportId, generation);
    expect(agents.control(agent.transportId)).toBe(current);
    expect(agents.attachFiles(agent, generation, data)).toBe(false);
    expect(
      agents.attachFiles({ ...agent, instanceId: "wrong" }, next, data),
    ).toBe(false);
    expect(agents.attachFiles(agent, next, data)).toBe(true);
  });

  it("checks the current registered agent key and transport revocation before use", () => {
    const { agents, transport } = fixture();
    const control = { close: vi.fn() };
    expect(
      agents.attachControl({ ...agent, publicKey: "unexpected" }, control),
    ).toBeUndefined();
    expect(agents.attachControl(agent, control)).toBeDefined();
    transport.disabledAt = 1;
    expect(agents.control(agent.transportId)).toBeUndefined();
    expect(control.close).toHaveBeenCalledTimes(1);
  });
});
