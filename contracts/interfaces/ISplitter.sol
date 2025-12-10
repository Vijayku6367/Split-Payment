// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface ISplitter {
    struct SplitConfig {
        address[] recipients;
        uint256[] shares; // in basis points (10000 = 100%)
        address token;
        address owner;
        bool active;
    }
    
    function distribute(uint256 amount) external;
    function updateShares(address[] memory newRecipients, uint256[] memory newShares) external;
    function emergencyWithdraw() external;
    function getConfig() external view returns (SplitConfig memory);
    function getTotalDistributed() external view returns (uint256);
}
