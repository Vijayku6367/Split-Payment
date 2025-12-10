import React, { useState } from 'react';
import { useWeb3 } from '../context/Web3Context';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES, SUPPORTED_TOKENS } from '../utils/constants';

const CreateSplit = () => {
  const { account, provider } = useWeb3();
  const [recipients, setRecipients] = useState([{ address: '', percentage: '' }]);
  const [token, setToken] = useState(SUPPORTED_TOKENS[0].address);
  const [splitName, setSplitName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const addRecipient = () => {
    setRecipients([...recipients, { address: '', percentage: '' }]);
  };

  const removeRecipient = (index) => {
    const newRecipients = [...recipients];
    newRecipients.splice(index, 1);
    setRecipients(newRecipients);
  };

  const updateRecipient = (index, field, value) => {
    const newRecipients = [...recipients];
    newRecipients[index][field] = value;
    setRecipients(newRecipients);
  };

  const validateRecipients = () => {
    let totalPercentage = 0;
    const seenAddresses = new Set();

    for (const recipient of recipients) {
      if (!ethers.isAddress(recipient.address)) {
        return { valid: false, error: 'Invalid Ethereum address' };
      }
      
      if (seenAddresses.has(recipient.address.toLowerCase())) {
        return { valid: false, error: 'Duplicate recipient address' };
      }
      seenAddresses.add(recipient.address.toLowerCase());

      const percentage = parseFloat(recipient.percentage);
      if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
        return { valid: false, error: 'Invalid percentage' };
      }
      totalPercentage += percentage;
    }

    if (Math.abs(totalPercentage - 100) > 0.01) {
      return { valid: false, error: 'Percentages must sum to 100%' };
    }

    return { valid: true };
  };

  const createSplit = async () => {
    if (!account || !provider) {
      setResult({ success: false, error: 'Please connect your wallet' });
      return;
    }

    const validation = validateRecipients();
    if (!validation.valid) {
      setResult({ success: false, error: validation.error });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const signer = await provider.getSigner();
      
      // Convert percentages to basis points (10000 = 100%)
      const recipientAddresses = recipients.map(r => r.address);
      const shares = recipients.map(r => Math.round(parseFloat(r.percentage) * 100));

      // ABI for the factory contract
      const factoryABI = [
        "function createSplitter(address[] recipients, uint256[] shares, address token) external returns (address)"
      ];

      const factory = new ethers.Contract(
        CONTRACT_ADDRESSES.Factory,
        factoryABI,
        signer
      );

      const tx = await factory.createSplitter(recipientAddresses, shares, token);
      setResult({ success: true, message: 'Transaction sent!', txHash: tx.hash });

      // Wait for confirmation
      const receipt = await tx.wait();
      
      // Get the created splitter address from events
      const event = receipt.logs.find(log => 
        log.fragment && log.fragment.name === 'SplitterCreated'
      );
      
      if (event) {
        const splitterAddress = event.args[1];
        setResult({ 
          success: true, 
          message: 'Split created successfully!',
          splitterAddress,
          txHash: tx.hash
        });
        
        // Reset form
        setRecipients([{ address: '', percentage: '' }]);
        setSplitName('');
      }

    } catch (error) {
      console.error('Error creating split:', error);
      setResult({ 
        success: false, 
        error: error.reason || error.message || 'Transaction failed' 
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">Create Split Contract</h1>
        <p className="text-gray-400">
          Configure automatic payment distribution between multiple recipients
        </p>
      </div>

      <div className="glass-card p-8">
        <div className="mb-8">
          <label className="block text-white font-medium mb-2">
            Split Name (Optional)
          </label>
          <input
            type="text"
            value={splitName}
            onChange={(e) => setSplitName(e.target.value)}
            className="w-full px-4 py-3 bg-dark-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-gold-500"
            placeholder="Team Payment Split"
          />
        </div>

        <div className="mb-8">
          <label className="block text-white font-medium mb-2">
            Payment Token
          </label>
          <select
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full px-4 py-3 bg-dark-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-gold-500"
          >
            {SUPPORTED_TOKENS.map((t) => (
              <option key={t.address} value={t.address}>
                {t.name} ({t.symbol})
              </option>
            ))}
          </select>
        </div>

        <div className="mb-8">
          <div className="flex justify-between items-center mb-4">
            <label className="block text-white font-medium">Recipients</label>
            <button
              onClick={addRecipient}
              className="px-4 py-2 bg-teal-500/20 text-teal-400 rounded-lg hover:bg-teal-500/30 transition"
            >
              <i className="fas fa-plus mr-2"></i>
              Add Recipient
            </button>
          </div>

          <div className="space-y-4">
            {recipients.map((recipient, index) => (
              <div key={index} className="flex items-center space-x-4">
                <div className="flex-1">
                  <input
                    type="text"
                    value={recipient.address}
                    onChange={(e) => updateRecipient(index, 'address', e.target.value)}
                    className="w-full px-4 py-3 bg-dark-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-gold-500"
                    placeholder="0x..."
                  />
                </div>
                <div className="w-32">
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max="100"
                      value={recipient.percentage}
                      onChange={(e) => updateRecipient(index, 'percentage', e.target.value)}
                      className="w-full px-4 py-3 bg-dark-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-gold-500 pr-10"
                      placeholder="%"
                    />
                    <span className="absolute right-3 top-3 text-gray-400">%</span>
                  </div>
                </div>
                {recipients.length > 1 && (
                  <button
                    onClick={() => removeRecipient(index)}
                    className="px-3 py-3 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition"
                  >
                    <i className="fas fa-trash"></i>
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 text-sm text-gray-400">
            Total: {recipients.reduce((sum, r) => sum + (parseFloat(r.percentage) || 0), 0).toFixed(2)}%
          </div>
        </div>

        {result && (
          <div className={`mb-6 p-4 rounded-lg ${
            result.success ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
          }`}>
            <div className="flex items-center">
              <i className={`fas fa-${result.success ? 'check-circle' : 'exclamation-triangle'} mr-3`}></i>
              <span>{result.message || result.error}</span>
            </div>
            {result.txHash && (
              <div className="mt-2 text-sm">
                <a 
                  href={`https://tempotestnet.io/tx/${result.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  View transaction
                </a>
              </div>
            )}
            {result.splitterAddress && (
              <div className="mt-2 text-sm">
                Splitter Address: 
                <code className="ml-2 bg-dark-800 px-2 py-1 rounded">
                  {result.splitterAddress}
                </code>
              </div>
            )}
          </div>
        )}

        <button
          onClick={createSplit}
          disabled={loading || !account}
          className={`w-full py-4 rounded-lg font-semibold transition ${
            loading || !account
              ? 'bg-gray-700 cursor-not-allowed'
              : 'btn-primary'
          }`}
        >
          {loading ? (
            <>
              <i className="fas fa-spinner fa-spin mr-2"></i>
              Creating Split Contract...
            </>
          ) : !account ? (
            'Connect Wallet to Continue'
          ) : (
            <>
              <i className="fas fa-bolt mr-2"></i>
              Create Split Contract
            </>
          )}
        </button>

        <div className="mt-6 text-sm text-gray-400">
          <p className="flex items-center mb-2">
            <i className="fas fa-info-circle mr-2 text-teal-400"></i>
            The split contract will be deployed on Tempo Blockchain
          </p>
          <p className="flex items-center">
            <i className="fas fa-shield-alt mr-2 text-teal-400"></i>
            You'll be able to update recipients and percentages later
          </p>
        </div>
      </div>
    </div>
  );
};

export default CreateSplit;
