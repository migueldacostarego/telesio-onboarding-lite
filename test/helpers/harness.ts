import { DIR_ID, RH_ID, listen, principal, setup } from './ctx';

type Ctx = ReturnType<typeof setup>;

export function harness(env: Record<string, string | undefined> = {}, opts: Parameters<typeof setup>[1] = {}) {
  let ctx: Ctx;
  let srv: Awaited<ReturnType<typeof listen>>;
  const send = (method: string, path: string, p: string, body: unknown, headers: Record<string, string>) =>
    fetch(`${srv.base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-ms-client-principal': p, ...headers },
      body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
  return {
    get ctx() {
      return ctx;
    },
    get base() {
      return srv.base;
    },
    async start() {
      ctx = setup(env, opts);
      srv = await listen(ctx.app);
    },
    stop: () => srv.close(),
    /** Appel en tant que valideur (par défaut) ou autre identité, sans rôle d'application. */
    call(method: string, path: string, who = DIR_ID, body: unknown = {}, headers: Record<string, string> = {}) {
      return send(method, path, principal([], who), body, headers);
    },
    /** Appel en tant que RH (rôle d'application RH). */
    callRh(method: string, path: string, body: unknown = {}, headers: Record<string, string> = {}) {
      return send(method, path, principal(['RH'], RH_ID), body, headers);
    },
  };
}
