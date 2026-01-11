import { NextRequest, NextResponse } from "next/server";
import { getOrCreateRoomBySessionId } from "@/actions/room";
import { generateAESKey } from "@/utils/crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";

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

    // Generate encryption key
    const encryptionKey = await generateAESKey();

    // Generate JWT token for WebSocket authentication
    if (!process.env.JWT_SECRET) {
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    // Ensure payload is valid
    const payload = { id: validated.id, email: "session@temp.internal" };
    if (!payload || !payload.id) {
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

    // Build redirect URL with room hash and name query param
    // Query params come before the hash in URLs
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || request.nextUrl.origin;
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
