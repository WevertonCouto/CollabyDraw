import dotenv from "dotenv";
dotenv.config();
import client from "@repo/db/client";
import { WebSocketMessage, WsDataType } from "@repo/common/types";
import { WebSocketServer, WebSocket } from "ws";
import jwt, { JwtPayload } from "jsonwebtoken";

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is ABSOLUTELY REQUIRED and not set");
}

const JWT_SECRET = process.env.JWT_SECRET;

declare module "http" {
  interface IncomingMessage {
    user: {
      id: string;
      email: string;
    };
  }
}

const wss = new WebSocketServer({ port: Number(process.env.PORT) || 8080 });

function authUser(token: string) {
  console.log("[WS-AUTH] Starting JWT verification", {
    tokenLength: token.length,
    tokenPrefix: token.substring(0, 20) + "...",
    jwtSecretSet: !!JWT_SECRET,
    jwtSecretLength: JWT_SECRET?.length || 0
  });
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    console.log("[WS-AUTH] JWT verification successful", {
      decodedType: typeof decoded,
      hasId: !!(decoded as any)?.id,
      hasEmail: !!(decoded as any)?.email,
      decodedKeys: decoded ? Object.keys(decoded) : []
    });
    
    if (typeof decoded == "string") {
      console.error("[WS-AUTH] Decoded token is a string, expected object");
      return null;
    }
    if (!decoded.id) {
      console.error("[WS-AUTH] No valid user ID in token", {
        decoded: decoded
      });
      return null;
    }
    
    console.log("[WS-AUTH] Authentication successful", {
      userId: decoded.id,
      email: (decoded as any).email || "no email"
    });
    return decoded.id;
  } catch (err) {
    console.error("[WS-AUTH] JWT verification failed", {
      error: err instanceof Error ? err.message : String(err),
      errorName: err instanceof Error ? err.name : "Unknown",
      errorStack: err instanceof Error ? err.stack : undefined
    });
    return null;
  }
}

type Connection = {
  connectionId: string;
  userId: string;
  userName: string;
  ws: WebSocket;
  rooms: string[];
};

const connections: Connection[] = [];
const roomShapes: Record<string, WebSocketMessage[]> = {};

function generateConnectionId(): string {
  return `conn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

wss.on("connection", function connection(ws, req) {
  console.log("[WS-AUTH] New WebSocket connection attempt", {
    url: req.url,
    headers: {
      origin: req.headers.origin,
      userAgent: req.headers["user-agent"]
    }
  });
  
  const url = req.url;
  if (!url) {
    console.error("[WS-AUTH] No valid URL found in request");
    ws.close(1008, "User not authenticated");
    return;
  }
  
  const queryParams = new URLSearchParams(url.split("?")[1]);
  const token = queryParams.get("token");
  console.log("[WS-AUTH] Token extraction", {
    url: url,
    hasToken: !!token,
    tokenLength: token?.length || 0,
    tokenPrefix: token ? token.substring(0, 20) + "..." : "no token",
    queryParamsKeys: Array.from(queryParams.keys())
  });
  
  if (!token || token === null) {
    console.error("[WS-AUTH] No valid token found in query params", {
      url: url,
      queryString: url.split("?")[1] || "no query string"
    });
    ws.close(1008, "User not authenticated");
    return;
  }
  
  const userId = authUser(token);
  if (!userId) {
    console.error("[WS-AUTH] Connection rejected: invalid user", {
      tokenLength: token.length,
      tokenPrefix: token.substring(0, 20) + "..."
    });
    ws.close(1008, "User not authenticated");
    return;
  }
  
  console.log("[WS-AUTH] Connection accepted", {
    userId: userId,
    tokenLength: token.length
  });

  const connectionId = generateConnectionId();
  const newConnection: Connection = {
    connectionId,
    userId,
    userName: userId,
    ws,
    rooms: [],
  };
  connections.push(newConnection);

  ws.send(
    JSON.stringify({
      type: WsDataType.CONNECTION_READY,
      connectionId,
    })
  );
  console.log("✅ Sent CONNECTION_READY to:", connectionId);

  ws.on("error", (err) => {
    console.error(`[WS-AUTH] WebSocket error for user ${userId}:`, {
      connectionId,
      userId,
      error: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack : undefined
    });
  });

  ws.on("message", async function message(data) {
    try {
      const parsedData: WebSocketMessage = JSON.parse(data.toString());
      console.log("[WS-AUTH] Received message", {
        connectionId,
        userId,
        messageType: parsedData.type,
        hasRoomId: !!parsedData.roomId,
        hasUserId: !!parsedData.userId
      });
      
      if (!parsedData) {
        console.error("[WS-AUTH] Error in parsing ws data");
        return;
      }

      if (!parsedData.roomId || !parsedData.userId) {
        console.error("[WS-AUTH] No userId or roomId provided for WS message", {
          parsedData
        });
        return;
      }

      const connection = connections.find(
        (x) => x.connectionId === connectionId
      );
      if (!connection) {
        console.error("[WS-AUTH] No connection found, closing", {
          connectionId,
          totalConnections: connections.length
        });
        ws.close(1008, "Connection not found");
        return;
      }

      if (parsedData.userName && connection.userName === userId) {
        // Update username for this connection
        connection.userName = parsedData.userName;

        // Sync username across all connections for this user
        connections
          .filter((conn) => conn.userId === userId)
          .forEach((conn) => {
            conn.userName = parsedData.userName ?? parsedData.userId;
          });
      }

      switch (parsedData.type) {
        case WsDataType.JOIN:
          {
            console.log("[WS-AUTH] Processing JOIN request", {
              connectionId,
              userId,
              roomId: parsedData.roomId
            });
            
            const roomCheckResponse = await client.room.findUnique({
              where: { id: parsedData.roomId },
            });

            console.log("[WS-AUTH] Room check result", {
              connectionId,
              roomId: parsedData.roomId,
              roomExists: !!roomCheckResponse
            });

            if (!roomCheckResponse) {
              console.error("[WS-AUTH] Room not found, closing connection", {
                connectionId,
                roomId: parsedData.roomId
              });
              ws.close(1008, "Room not found");
              return;
            }

            if (!connection.rooms.includes(parsedData.roomId)) {
              connection.rooms.push(parsedData.roomId);
            }

            const participants = getCurrentParticipants(parsedData.roomId);

            if (!roomShapes[parsedData.roomId]) {
              roomShapes[parsedData.roomId] = [];
            }

            ws.send(
              JSON.stringify({
                type: WsDataType.USER_JOINED,
                roomId: parsedData.roomId,
                userId: connection.userId,
                userName: connection.userName,
                connectionId: connection.connectionId,
                participants,
                timestamp: new Date().toISOString(),
              })
            );

            const shapes = roomShapes[parsedData.roomId] || [];

            if (shapes && shapes.length > 0) {
              ws.send(
                JSON.stringify({
                  type: WsDataType.EXISTING_SHAPES,
                  roomId: parsedData.roomId,
                  message: shapes,
                  timestamp: new Date().toISOString(),
                })
              );
            }

            // Don't broadcast JOIN to the user's other tabs if this is a duplicate tab
            const isFirstTabInRoom = connections
              .filter(
                (conn) =>
                  conn.userId === connection.userId &&
                  conn.connectionId !== connection.connectionId
              )
              .every((conn) => !conn.rooms.includes(parsedData.roomId));

            if (isFirstTabInRoom) {
              broadcastToRoom(
                parsedData.roomId,
                {
                  type: WsDataType.USER_JOINED,
                  roomId: parsedData.roomId,
                  userId: connection.userId,
                  userName: connection.userName,
                  connectionId: connection.connectionId,
                  participants,
                  timestamp: new Date().toISOString(),
                  id: null,
                  message: null,
                },
                [connection.connectionId],
                true
              );
            }
          }
          break;

        case WsDataType.LEAVE:
          connection.rooms = connection.rooms.filter(
            (r) => r !== parsedData.roomId
          );

          const userHasOtherTabsInRoom = connections.some(
            (conn) =>
              conn.userId === connection.userId &&
              conn.connectionId !== connection.connectionId &&
              conn.rooms.includes(parsedData.roomId)
          );

          if (!userHasOtherTabsInRoom) {
            broadcastToRoom(
              parsedData.roomId,
              {
                type: WsDataType.USER_LEFT,
                userId: connection.userId,
                userName: connection.userName,
                connectionId: connection.connectionId,
                roomId: parsedData.roomId,
                id: null,
                message: null,
                participants: null,
                timestamp: new Date().toISOString(),
              },
              [connection.connectionId],
              true
            );
          }

          const anyConnectionsInRoom = connections.some((conn) =>
            conn.rooms.includes(parsedData.roomId)
          );

          if (!anyConnectionsInRoom) {
            try {
              await client.room.delete({
                where: { id: parsedData.roomId },
              });
              delete roomShapes[parsedData.roomId];
              console.log(`Deleted empty room ${parsedData.roomId}`);
            } catch (err) {
              console.error(`Failed to delete room ${parsedData.roomId}`, err);
            }
          }
          break;

        case WsDataType.CLOSE_ROOM: {
          const connectionsInRoom = connections.filter((conn) =>
            conn.rooms.includes(parsedData.roomId)
          );

          if (
            connectionsInRoom.length === 1 &&
            connectionsInRoom[0] &&
            connectionsInRoom[0].connectionId === connectionId
          ) {
            try {
              await client.room.delete({
                where: { id: parsedData.roomId },
              });

              delete roomShapes[parsedData.roomId];

              connectionsInRoom.forEach((conn) => {
                if (conn.ws.readyState === WebSocket.OPEN) {
                  conn.ws.send(
                    JSON.stringify({
                      type: "ROOM_CLOSED",
                      roomId: parsedData.roomId,
                      timestamp: new Date().toISOString(),
                    })
                  );
                }

                conn.rooms = conn.rooms.filter((r) => r !== parsedData.roomId);
              });

              console.log(
                `Room ${parsedData.roomId} closed by connection ${connectionId}`
              );
            } catch (err) {
              console.error("Error deleting room:", err);
            }
          }
        }

        case WsDataType.CURSOR_MOVE:
          if (
            parsedData.roomId &&
            parsedData.userId &&
            parsedData.connectionId &&
            parsedData.message
          ) {
            broadcastToRoom(
              parsedData.roomId,
              {
                type: parsedData.type,
                roomId: parsedData.roomId,
                userId: connection.userId,
                userName: connection.userName,
                connectionId: connection.connectionId,
                message: parsedData.message,
                timestamp: new Date().toISOString(),
                id: null,
                participants: null,
              },
              [parsedData.connectionId],
              false
            );
          } else {
            console.warn("[WS] CURSOR_MOVE missing required fields:", {
              hasRoomId: !!parsedData.roomId,
              hasUserId: !!parsedData.userId,
              hasConnectionId: !!parsedData.connectionId,
              hasMessage: !!parsedData.message
            });
          }
          break;

        case WsDataType.STREAM_SHAPE:
          broadcastToRoom(
            parsedData.roomId,
            {
              type: parsedData.type,
              id: parsedData.id,
              message: parsedData.message,
              roomId: parsedData.roomId,
              userId: connection.userId,
              userName: connection.userName,
              connectionId: connection.connectionId,
              timestamp: new Date().toISOString(),
              participants: null,
            },
            [connection.connectionId],
            false
          );
          break;

        case WsDataType.STREAM_UPDATE:
          broadcastToRoom(
            parsedData.roomId,
            {
              type: parsedData.type,
              id: parsedData.id,
              message: parsedData.message,
              roomId: parsedData.roomId,
              userId: connection.userId,
              userName: connection.userName,
              connectionId: connection.connectionId,
              timestamp: new Date().toISOString(),
              participants: null,
            },
            [connection.connectionId],
            false
          );
          break;

        case WsDataType.DRAW: {
          if (!parsedData.message || !parsedData.id || !parsedData.roomId) {
            console.error(
              `Missing shape Id or shape message data for ${parsedData.type}`
            );
            return;
          }

          if (!roomShapes[parsedData.roomId]) {
            roomShapes[parsedData.roomId] = [];
          }
          const shapes = (roomShapes[parsedData.roomId] ||= []);
          const shapeIndex = shapes.findIndex((s) => s.id === parsedData.id);

          if (shapeIndex !== -1) {
            shapes[shapeIndex] = parsedData;
          } else {
            shapes.push(parsedData);
          }

          broadcastToRoom(
            parsedData.roomId,
            {
              type: parsedData.type,
              message: parsedData.message,
              roomId: parsedData.roomId,
              userId: connection.userId,
              userName: connection.userName,
              connectionId: connection.connectionId,
              timestamp: new Date().toISOString(),
              id: parsedData.id,
              participants: null,
            },
            [],
            false
          );
          break;
        }
        case WsDataType.UPDATE: {
          if (!parsedData.message || !parsedData.id || !parsedData.roomId) {
            console.error(
              `Missing shape Id or shape message data for ${parsedData.type}`
            );
            return;
          }

          const shapes = (roomShapes[parsedData.roomId] ||= []);
          const shapeIndex = shapes.findIndex((s) => s.id === parsedData.id);

          if (shapeIndex !== -1) {
            shapes[shapeIndex] = parsedData;
          } else {
            shapes.push(parsedData);
          }

          broadcastToRoom(
            parsedData.roomId,
            {
              type: parsedData.type,
              id: parsedData.id,
              message: parsedData.message,
              roomId: parsedData.roomId,
              userId: connection.userId,
              userName: connection.userName,
              connectionId: connection.connectionId,
              participants: null,
              timestamp: new Date().toISOString(),
            },
            [],
            false
          );
          break;
        }
        case WsDataType.ERASER:
          if (!parsedData.id) {
            console.error(`Missing shape Id for ${parsedData.type}`);
            return;
          }

          const shapes = (roomShapes[parsedData.roomId] ||= []);
          roomShapes[parsedData.roomId] = shapes.filter(
            (s) => s.id !== parsedData.id
          );

          broadcastToRoom(
            parsedData.roomId,
            {
              id: parsedData.id,
              type: parsedData.type,
              roomId: parsedData.roomId,
              userId: connection.userId,
              userName: connection.userName,
              connectionId: connection.connectionId,
              timestamp: new Date().toISOString(),
              message: null,
              participants: null,
            },
            [],
            false
          );
          break;

        default:
          console.warn(
            `Unknown message type received from connection ${connectionId}:`,
            parsedData.type
          );
          break;
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  });

  ws.on("close", (code, reason) => {
    console.log("[WS-AUTH] Connection closed by server/client", {
      connectionId,
      userId,
      code,
      reason: reason.toString(),
      wasClean: code === 1000 || code === 1001
    });
    
    const connection = connections.find(
      (conn) => conn.connectionId === connectionId
    );
    if (connection) {
      console.log("[WS-AUTH] Cleaning up connection", {
        connectionId,
        userId,
        rooms: connection.rooms,
        totalRooms: connection.rooms.length
      });
      
      // For each room this connection was in
      connection.rooms.forEach((roomId) => {
        // Check if this was the last connection from this user in the room
        const userHasOtherConnectionsInRoom = connections.some(
          (conn) =>
            conn.userId === connection.userId &&
            conn.connectionId !== connectionId &&
            conn.rooms.includes(roomId)
        );

        // Only broadcast USER_LEFT if this was the last connection for this user
        if (!userHasOtherConnectionsInRoom) {
          broadcastToRoom(
            roomId,
            {
              type: WsDataType.USER_LEFT,
              userId: connection.userId,
              userName: connection.userName,
              connectionId: connection.connectionId,
              roomId,
              id: null,
              message: null,
              participants: null,
              timestamp: new Date().toISOString(),
            },
            [connectionId],
            true
          );
        }

        // Check if the room is now empty
        const roomIsEmpty = !connections.some(
          (conn) =>
            conn.connectionId !== connectionId && conn.rooms.includes(roomId)
        );

        // Delete empty rooms
        if (roomIsEmpty) {
          client.room
            .delete({
              where: { id: roomId },
            })
            .then(() => {
              delete roomShapes[roomId];
              console.log(
                `Deleted empty room ${roomId} after last connection left`
              );
            })
            .catch((err) => {
              console.error(`Failed to delete empty room ${roomId}:`, err);
            });
        }
      });
    }

    // Remove the connection from our connections array
    const index = connections.findIndex(
      (conn) => conn.connectionId === connectionId
    );
    if (index !== -1) {
      connections.splice(index, 1);
      console.log("[WS-AUTH] Connection removed from connections array", {
        connectionId,
        userId,
        remainingConnections: connections.length
      });
    } else {
      console.warn("[WS-AUTH] Connection not found in array when closing", {
        connectionId,
        userId,
        totalConnections: connections.length
      });
    }
  });
});

function broadcastToRoom(
  roomId: string,
  message: WebSocketMessage,
  excludeConnectionIds: string[] = [],
  includeParticipants: boolean = false
) {
  if (
    (includeParticipants && !message.participants) ||
    message.type === WsDataType.USER_JOINED
  ) {
    message.participants = getCurrentParticipants(roomId);
  }

  let sentCount = 0;
  let skippedCount = 0;
  connections.forEach((conn) => {
    if (
      conn.rooms.includes(roomId) &&
      !excludeConnectionIds.includes(conn.connectionId)
    ) {
      try {
        if (conn.ws.readyState === WebSocket.OPEN) {
          conn.ws.send(JSON.stringify(message));
          sentCount++;
        } else {
          skippedCount++;
        }
      } catch (err) {
        console.error(
          `[WS] Error sending message to connection ${conn.connectionId}:`,
          err
        );
      }
    }
  });
}

function getCurrentParticipants(roomId: string) {
  const map = new Map();
  connections
    .filter((conn) => conn.rooms.includes(roomId))
    .forEach((conn) =>
      map.set(conn.userId, { userId: conn.userId, userName: conn.userName })
    );
  return Array.from(map.values());
}

wss.on("listening", () => {
  console.log(`WebSocket server started on port ${process.env.PORT || 8080}`);
});
