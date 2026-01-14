import { NextRequest, NextResponse } from "next/server";
import { getOrCreateRoomBySessionId } from "@/actions/room";
import { generateDeterministicAESKey } from "@/utils/crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { randomUUID } from "crypto";

const BoardAccessSchema = z.object({
  id: z.string().min(1, "Session ID is required"),
  name: z.string().min(1, "User name is required").max(100),
});

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const sessionId = searchParams.get("id");
    const userName = searchParams.get("name");

    // Validate parameters
    const validated = BoardAccessSchema.parse({
      id: sessionId || undefined,
      name: userName || undefined,
    });

    // Get or create room with session ID
    const roomResult = await getOrCreateRoomBySessionId(validated.id);

    if (!roomResult.success || !roomResult.room) {
      return NextResponse.json(
        { error: "Failed to create or access board" },
        { status: 500 }
      );
    }

    // Generate deterministic encryption key based on room ID
    // This ensures all clients in the same room use the same key
    const encryptionKey = await generateDeterministicAESKey(validated.id);

    // Generate JWT token for WebSocket authentication
    console.log("[WS-TOKEN] Checking JWT_SECRET availability", {
      hasJwtSecret: !!process.env.JWT_SECRET,
      jwtSecretLength: process.env.JWT_SECRET?.length || 0
    });
    
    if (!process.env.JWT_SECRET) {
      console.error("[WS-TOKEN] JWT_SECRET not found in environment");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    // Generate unique userId for this user session
    // Each user gets a unique ID even if they're in the same room
    const uniqueUserId = randomUUID();
    console.log("[WS-TOKEN] Generated unique userId", {
      userId: uniqueUserId,
      sessionId: validated.id,
      userName: validated.name
    });

    // Ensure payload is valid
    const payload = { id: uniqueUserId, email: "session@temp.internal" };
    console.log("[WS-TOKEN] JWT payload prepared", {
      payload: payload,
      hasId: !!payload.id,
      hasEmail: !!payload.email
    });
    
    if (!payload || !payload.id) {
      console.error("[WS-TOKEN] Invalid payload structure", {
        payload: payload
      });
      return NextResponse.json(
        { error: "Invalid session data" },
        { status: 500 }
      );
    }

    const token = jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    
    console.log("[WS-TOKEN] JWT token generated successfully", {
      tokenLength: token.length,
      tokenPrefix: token.substring(0, 20) + "...",
      payload: payload,
      expiresIn: "7d"
    });

    // Build redirect URL with room hash and name query param
    // Query params come before the hash in URLs
    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || request.nextUrl.origin).replace(/\/$/, '');
    const redirectUrl = `${baseUrl}/?name=${encodeURIComponent(validated.name)}#room=${validated.id},${encryptionKey}`;

    // Store token in cookie (non-httpOnly so it can be read on client for WebSocket)
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set("accessToken", token, {
      maxAge: 60 * 60 * 24 * 7, // 7 days
      httpOnly: false, // Must be false to read on client for WebSocket
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });

    console.log("[WS-TOKEN] Token stored in cookie", {
      cookieName: "accessToken",
      tokenLength: token.length,
      maxAge: 60 * 60 * 24 * 7,
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      redirectUrl: redirectUrl,
      sessionId: validated.id,
      userName: validated.name
    });

    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid parameters", details: error.errors },
        { status: 400 }
      );
    }

    console.error("Error accessing board:", error);
    return NextResponse.json(
      { error: "Failed to access board" },
      { status: 500 }
    );
  }
}
