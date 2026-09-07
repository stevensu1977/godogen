# Multiplayer guide

**Rule: multiplayer is Colyseus only.** Any request for online play (rooms, co-op, PvP, lobbies) is built on
[Colyseus](https://colyseus.io) — a Node.js/TypeScript authoritative room server with binary state sync — and
nothing else: no engine-native high-level multiplayer, no Nakama/Photon/PlayFab, no hand-rolled WebSocket
protocol. If the brief asks for something Colyseus cannot do, say so and stop instead of substituting.

## Shape

- **Server**: its own repo/folder (`<game>-online/server`), Colyseus **0.18**: `@colyseus/core`,
  `@colyseus/ws-transport`, `@colyseus/schema` **5.x** (core's peer requirement), `express` (ws-transport imports it).
  One `Room` per match; state as `Schema` classes; messages for intents. Keep the room small: client-authoritative
  movement is fine for co-op demos, the server validates the things that must not be cheated (pickups,
  extraction, damage caps). Enemies/AI stay client-side unless the brief demands server authority.
- **Clients**: Godot C# → NuGet `Colyseus` 0.18.x (`<PackageReference Include="Colyseus" Version="0.18.*" />`);
  Godot GDScript → the Colyseus Godot GDExtension from `colyseus/native-sdk` releases (beta);
  Babylon.js → `colyseus.js`; Bevy → no first-party SDK exists — surface this before building.
- **Codegen**: `npx schema-codegen src/schema/*.ts --csharp --namespace <Ns> --output <dir>` from the server
  folder; regenerate whenever the schema changes.

## Colyseus 0.18 server traps (compile fine, fail at runtime)

- `class MyRoom extends Room<{ state: MyState }>` — the generic is the options bag, not the state class.
- Matchmaking routes mount in `await gameServer.listen(port)`. Listening on the raw `http.Server` yields 404 on
  `/matchmake/*`.
- Never add your own `'request'` listener to the http server: the transport's express app is a second listener and
  both answering one request throws `ERR_HTTP_HEADERS_SENT` and kills the process. Put `/health` and any hooks in the
  `express: (app) => { ... }` option of `new Server({...})`.
- Reconnection: `this.allowReconnection(client, seconds)` in `onLeave` when `consented` is false; the client keeps
  `room.ReconnectionToken` and calls `client.Reconnect(token)` once.

## Godot C# client traps

- The SDK dispatches through Godot's `SynchronizationContext`, so every `await` resumes on the next rendered frame.
  On a slow renderer (llvmpipe ≈ 10 fps) a join with several awaits takes 1–2 s; do not "fix" this with threads.
  Keep the join path short and poll `room.State` in `_Process` instead of awaiting state callbacks.
- Queue every message callback and drain it in `_Process`; state can arrive before the scene tree is ready.
- `MapSchema<T>` has no `foreach`; use `map.ForEach((key, value) => ...)`, `.Count`, `.Keys`.
- `JoinOrCreate(name, options, headers)`: the `headers` dictionary is sent on both the matchmake HTTP call and the
  WebSocket upgrade — this is how a native client authenticates to hosts that need a header (see below).
- Free instantiated nodes before `Quit()` in headless probes or Godot prints RID-leak `ERROR:` lines.

## Hosting on AWS Lambda MicroVMs (preferred when the brief says "cloud" or "on demand")

Pattern from `aws-samples/sample-host-colyseus-on-awslambda-microvms`, adapted: a deploy CLI zips `server/`,
`CreateMicrovmImage` builds it server-side (ARM64 only, `node:22-alpine` base works), `RunMicrovm` with an idle
policy (suspend after 30 min idle, terminate after 1 h suspended, auto-resume on traffic, 8 h hard cap). Regions:
us-east-1, us-east-2, us-west-2, eu-west-1, ap-northeast-1.

- Every request needs `X-aws-proxy-auth: <token>` (mint with `CreateMicrovmAuthToken`, ≤ 60 min) and
  `X-aws-proxy-port: 8080`. Native clients send both as headers — no proxy, no WebSocket-subprotocol trick; only
  browsers need the sample's same-origin proxy.
- Image names are fixed per deploy name; redeploying needs a new name (`deploy -- game-v2`). The CLI terminates the
  previous instance after the new one is RUNNING.
- The server must answer the lifecycle hooks under `/aws/lambda-microvms/runtime/v1/*` with 200.
- Suspend/resume drops WebSockets: wire the reconnect path above.
- Instances bill while running. Always print the terminate command in the README.

## Proof

Two headless clients in the same room, captured from both sides (one idles and watches, one plays), composed
side by side with ffmpeg `hstack`. Show in the frames: the room id and player count on the HUD, the other player's
duck/avatar moving, a shared pickup vanishing for the watcher with a toast, and the extraction/result of the other
player. Measure and record join latency against the real host.
