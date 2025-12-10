export const TEMPO_CONFIG = {
  // Mainnet configuration
  mainnet: {
    chainId: '0x27d8', // 10200 in hex
    chainName: 'Tempo Mainnet',
    rpcUrls: ['https://rpc.tempo.network'],
    blockExplorerUrls: ['https://tempotestnet.io'],
    nativeCurrency: {
      name: 'Tempo',
      symbol: 'TEMPO',
      decimals: 18
    }
  },
  
  // Testnet configuration
  testnet: {
    chainId: '0x27d9', // 10201 in hex
    chainName: 'Tempo Testnet',
    rpcUrls: ['https://testnet.rpc.tempo.network'],
    blockExplorerUrls: ['https://testnet.tempotestnet.io'],
    nativeCurrency: {
      name: 'Test Tempo',
      symbol: 'TTEMPO',
      decimals: 18
    }
  }
};

// Supported ERC20 tokens on Tempo
export const SUPPORTED_TOKENS = {
  mainnet: [
    {
      address: '0x...USDC_ON_TEMPO...',
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      logo: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png'
    },
    {
      address: '0x...USDT_ON_TEMPO...',
      name: 'Tether USD',
      symbol: 'USDT',
      decimals: 6,
      logo: 'https://cryptologos.cc/logos/tether-usdt-logo.png'
    },
    {
      address: '0x...DAI_ON_TEMPO...',
      name: 'Dai Stablecoin',
      symbol: 'DAI',
      decimals: 18,
      logo: 'https://cryptologos.cc/logos/multi-collateral-dai-dai-logo.png'
    }
  ],
  testnet: [
    {
      address: '0x...TEST_USDC...',
      name: 'Test USDC',
      symbol: 'tUSDC',
      decimals: 6,
      logo: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png'
    },
    {
      address: '0x...TEST_USDT...',
      name: 'Test USDT',
      symbol: 'tUSDT',
      decimals: 6,
      logo: 'https://cryptologos.cc/logos/tether-usdt-logo.png'
    }
  ]
};

// Contract addresses (deploy and update these)
export const CONTRACT_ADDRESSES = {
  mainnet: {
    SplitFactory: '0x...',
    Treasury: '0x...'
  },
  testnet: {
    SplitFactory: '0x...',
    Treasury: '0x...'
  }
};
