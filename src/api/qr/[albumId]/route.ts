import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { APP_BASE_URL } from '@/lib/utils/env';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ albumId: string }> }
) {
  const { albumId } = await params;
  const requestUrl = new URL(request.url);
  const defaultBase = `${requestUrl.protocol}//${requestUrl.host}`;
  const baseUrl = (APP_BASE_URL || defaultBase).replace(/\/$/, '');
  const url = `${baseUrl}/album/${albumId}`;

  try {
    const qr = await QRCode.toDataURL(url);
    return NextResponse.json({ qr });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
