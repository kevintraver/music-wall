import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import os from 'os';

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const localIP = getLocalIP();

export async function GET(
  request: NextRequest,
  { params }: { params: { albumId: string } }
) {
  const albumId = params.albumId;
  const url = `http://${localIP}:3000/album/${albumId}`;

  try {
    const qr = await QRCode.toDataURL(url);
    return NextResponse.json({ qr });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}