import 'node-fetch';

const getLatestBlockTimestamp = async (evmRpcAddress) => {
  try {
    const blockNumberData = await fetch(evmRpcAddress, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
    }).then(res => res.json());

    const blockDetailsData = await fetch(evmRpcAddress, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBlockByNumber',
        params: [blockNumberData.result, false],
        id: 1,
      }),
    }).then(res => res.json());

    const timestampHex = blockDetailsData.result.timestamp;
    const date = new Date(parseInt(timestampHex, 16) * 1000);

    console.log(`Timestamp: ${date.toUTCString()}`);
  } catch (error) {
    console.error('Error fetching the latest block timestamp:', error);
  }
};

// Usage
const evmRpcAddress = 'https://evmos-json-rpc.stakely.io';
getLatestBlockTimestamp(evmRpcAddress);
