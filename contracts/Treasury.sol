// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./interfaces/IERC20.sol";

contract Treasury {
    address public owner;
    mapping(address => uint256) public balances;
    address[] public supportedTokens;
    
    event FundsDeposited(address indexed from, address token, uint256 amount);
    event FundsWithdrawn(address indexed to, address token, uint256 amount);
    event BatchDistribution(address indexed token, uint256 totalAmount, uint256 recipientCount);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }
    
    constructor() {
        owner = msg.sender;
    }
    
    function deposit(address token, uint256 amount) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        balances[token] += amount;
        
        // Add to supported tokens if not already
        bool exists = false;
        for (uint256 i = 0; i < supportedTokens.length; i++) {
            if (supportedTokens[i] == token) {
                exists = true;
                break;
            }
        }
        if (!exists) {
            supportedTokens.push(token);
        }
        
        emit FundsDeposited(msg.sender, token, amount);
    }
    
    function withdraw(address token, uint256 amount) external onlyOwner {
        require(balances[token] >= amount, "Insufficient balance");
        
        IERC20(token).transfer(owner, amount);
        balances[token] -= amount;
        
        emit FundsWithdrawn(owner, token, amount);
    }
    
    function batchDistribute(
        address token,
        address[] memory recipients,
        uint256[] memory amounts
    ) external onlyOwner {
        require(recipients.length == amounts.length, "Arrays length mismatch");
        require(balances[token] > 0, "No balance for token");
        
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalAmount += amounts[i];
        }
        
        require(balances[token] >= totalAmount, "Insufficient funds");
        
        for (uint256 i = 0; i < recipients.length; i++) {
            IERC20(token).transfer(recipients[i], amounts[i]);
        }
        
        balances[token] -= totalAmount;
        
        emit BatchDistribution(token, totalAmount, recipients.length);
    }
    
    function getSupportedTokens() external view returns (address[] memory) {
        return supportedTokens;
    }
    
    function getTokenBalance(address token) external view returns (uint256) {
        return balances[token];
    }
}
