import { Server } from "socket.io";

/**
 * Phase 6 Step 27ish — Anonymous Chat / lead-gen chatbot. Real-time layer,
 * added for this feature (socket.io was not installed/wired anywhere in
 * this backend before — checked with the user first, confirmed to add it).
 *
 * Deliberately simpler than V1's dual-room-cast pattern
 * (`${chatId}-anon_customer-admin`/`${chatId}-customer-admin`, kept in sync
 * for an anon->logged-in migration case): there is no admin/EM inbox UI in
 * this codebase to migrate a room identity FOR, so every chat here just
 * lives in a single room keyed by its own chatId. A client joins with
 * `socket.emit("join_chat", chatId)`; the bot's replies are pushed with
 * `io.to(room(chatId)).emit("new_message", payload)` from
 * chatBotEngine.js/customerChatController.js.
 *
 * CORS mirrors app.js's own HTTP CORS policy (FRONTEND_URL + local/LAN dev
 * origins) rather than inventing a second policy to keep in sync.
 */
export const room = (chatId) => `chat:${chatId}`;

const isDevOrigin = (origin) => {
  if (!origin) return true;
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)
    );
  } catch {
    return false;
  }
};

export function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (origin === process.env.FRONTEND_URL || isDevOrigin(origin)) {
          return callback(null, true);
        }
        callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    socket.on("join_chat", (chatId) => {
      if (typeof chatId === "string" && chatId.trim()) {
        socket.join(room(chatId.trim()));
      }
    });

    socket.on("leave_chat", (chatId) => {
      if (typeof chatId === "string" && chatId.trim()) {
        socket.leave(room(chatId.trim()));
      }
    });
  });

  return io;
}

export default initSocket;
