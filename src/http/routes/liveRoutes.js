// liveRoutes.js — server-sent events, so a console updates itself.
//
// SSE rather than WebSockets: this is a one-way stream of small JSON frames, it
// runs over plain HTTP, it reconnects on its own, and it needs no dependency —
// `new EventSource("/api/live")` in the browser is the whole client.
//
// The stream is authenticated, and that is not incidental. Event summaries carry
// trace codes, and a trace code with no passphrase behind it opens the reporter's
// own view of a report. A public ticker would therefore be a way to harvest
// working credentials, so this route sits behind a session and LiveFeed filters
// every frame by college on top of that.

import { Router } from "express";
import { requireAccount } from "../middleware/auth.js";
import { P } from "../../core/accounts/permissions.js";

const KEEPALIVE_MS = 25_000;

export function liveRoutes({ container }) {
  const api = Router();

  api.get("/", requireAccount(), (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tells nginx and friends not to buffer, which would otherwise hold every
      // frame back until the response ended — i.e. never.
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    const platform = req.account.can(P.PLATFORM_METRICS_READ);
    const client = {
      platform,
      collegeId: req.account.collegeId ?? null,
      write: (chunk) => res.write(chunk),
    };

    res.write(`retry: 3000\n\n`);
    res.write(`event: hello\ndata: ${JSON.stringify({
      scope: platform ? "platform" : "college",
      at: Date.now(),
    })}\n\n`);

    // subscribe() replays the last few items it is allowed to show this client,
    // so a console that has just loaded is not staring at an empty ticker.
    const unsubscribe = container.live.subscribe(client);

    // A comment frame. Keeps intermediaries from treating an idle stream as dead.
    const beat = setInterval(() => res.write(`: beat ${Date.now()}\n\n`), KEEPALIVE_MS);
    beat.unref?.();

    const stop = () => {
      clearInterval(beat);
      unsubscribe();
      res.end();
    };
    req.on("close", stop);
    req.on("error", stop);
  });

  return api;
}
