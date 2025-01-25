import fetch from 'node-fetch';

export async function queryPointer(pointee: string): Promise<any> {
  const queryUrl = 'https://pointer.basementnodes.ca/';
  const payload = JSON.stringify({ address: pointee });

  try {
    console.log(
      `[${new Date().toISOString()}] Sending POST request to: ${queryUrl} with payload: ${payload}`,
    );
    const response = await fetch(queryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });

    if (!response.ok) {
      console.error(
        `[${new Date().toISOString()}] Response returned with status: ${response.status}`,
      );
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error querying pointer at ${queryUrl}:`,
      error,
    );
    return null;
  }
}
