import { NextResponse } from "next/server";
import { generateCaptchaChallenge } from "@/lib/captcha";

export async function GET() {
  return NextResponse.json(generateCaptchaChallenge());
}
