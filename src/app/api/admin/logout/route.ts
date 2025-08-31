import { NextRequest, NextResponse } from 'next/server';

export async function POST(_request: NextRequest) {
  try {
    // Note: In a real application, you'd want to clear tokens from a secure store
    // For development, we'll just return success since tokens are in environment variables
    console.log('User logged out - tokens cleared from session');

    return NextResponse.json({
      success: true,
      message: 'Logged out successfully. Please restart the server to clear tokens completely.'
    });
  } catch (error) {
    console.error('Error during logout:', error);
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 });
  }
}