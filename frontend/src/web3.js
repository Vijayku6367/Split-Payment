import { ethers } from 'ethers';

let provider;
let signer;

export async function connectWallet() {
  if (typeof window.ethereum !== 'undefined') {
    try {
      // Request account access
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      
      provider = new ethers.BrowserProvider(window.ethereum);
      signer = await provider.getSigner();
      const address = await signer.getAddress();
      
      console.log('Connected:', address);
      return { success: true, address };
      
    } catch (error) {
      console.error('Connection error:', error);
      return { success: false, error: error.message };
    }
  } else {
    return { success: false, error: 'Please install MetaMask!' };
  }
}

export async function getWalletAddress() {
  if (signer) {
    return await signer.getAddress();
  }
  return null;
}

export function getProvider() {
  return provider;
}

export function getSigner() {
  return signer;
}
