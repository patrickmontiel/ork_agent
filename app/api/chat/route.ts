import { NextResponse } from "next/server";
import { chat } from "@/lib/agent";
import { publicState } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const { text } = await req.json();
  if (!text || typeof text !== "string") return NextResponse.json({ error: "Falta el mensaje" }, { status: 400 });
  const { reply, provider } = await chat(text.slice(0, 500));
  return NextResponse.json({ reply, provider, state: publicState() });
}
