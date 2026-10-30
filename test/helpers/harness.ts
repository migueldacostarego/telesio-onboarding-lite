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
    /** Appel en tant que personne de la direction (rôle Direction, objectId DIR_ID par défaut) ou autre identité portant ce rôle. */
    call(method: string, path: string, who = DIR_ID, body: unknown = {}, headers: Record<string, string> = {}) {
      return send(method, path, principal(['Direction'], who), body, headers);
    },
    /** Appel avec les rôles d'application et l'objectId donnés (ex. Direction, ou RH et Direction). */
    callAs(roles: string[], oid: string, method: string, path: string, body: unknown = {}, headers: Record<string, string> = {}) {
      return send(method, path, principal(roles, oid), body, headers);
    },
    /** Appel en tant que RH (rôle d'application RH). */
    callRh(method: string, path: string, body: unknown = {}, headers: Record<string, string> = {}) {
      return send(method, path, principal(['RH'], RH_ID), body, headers);
    },
  };
}
