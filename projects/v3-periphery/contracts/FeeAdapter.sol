// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


contract FeeAdapter {
    

    address public owner;
    address public vault;

    uint256 public constant RATIO_SCALE = 1_000_000; // 100% = 1_000_000

    // pool => total fee ratio in bp (e.g., 50_000 = 5%)
    mapping(address => uint256) public poolTotalFeeRatio;

    // pool => role => share (in bp)
    mapping(address => mapping(bytes32 => uint256)) public poolRoleShares;

    // pool => role => recipient
    mapping(address => mapping(bytes32 => address)) public poolRoleRecipients;

    // pool => list of fixed roles
    mapping(address => bytes32[]) public poolRoles;

    // pool => refer share (in bp)
    mapping(address => uint256) public poolReferShare;

    // user => token => claimable balance
    mapping(address => mapping(address => uint256)) public pendingBalances;

    constructor(address _vault) {
        require(_vault != address(0), "Invalid vault address");
        owner = msg.sender;
        vault = _vault;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyVault() {
        require(msg.sender == vault, "Not vault");
        _;
    }

    // ============ Admin Functions ============

    function setVault(address newVault) external onlyOwner {
        require(newVault != address(0), "Invalid vault address");
        vault = newVault;
    }

    function setPoolTotalFeeRatio(address pool, uint256 ratio) external onlyOwner {
        require(ratio <= RATIO_SCALE, "Invalid total ratio");
        poolTotalFeeRatio[pool] = ratio;
    }

    function setPoolRole(
        address pool,
        bytes32 role,
        address recipient,
        uint256 share
    ) external onlyOwner {
        require(recipient != address(0), "Invalid address");
        require(share <= RATIO_SCALE, "Share too big");

        if (poolRoleShares[pool][role] == 0) {
            poolRoles[pool].push(role);
        }

        poolRoleShares[pool][role] = share;
        poolRoleRecipients[pool][role] = recipient;
    }

    function setPoolReferShare(address pool, uint256 share) external onlyOwner {
        require(share <= RATIO_SCALE, "Invalid refer share");
        poolReferShare[pool] = share;
    }

    function getPoolRoles(address pool) external view returns (bytes32[] memory) {
        return poolRoles[pool];
    }

    // ============ Called by Vault Only ============

    /// @notice Must be called by Vault after token transferred to this contract
    function recordFee(
        address pool,
        address refer,
        address token,
        uint256 totalFeeAmount
    ) external onlyVault {
        uint256 totalRatio = poolTotalFeeRatio[pool];
        uint256 referRatio = poolReferShare[pool];
        require(referRatio <= totalRatio, "Refer too large");

        bytes32[] memory roles = poolRoles[pool];
        uint256 totalFixed = 0;

        for (uint256 i = 0; i < roles.length; i++) {
            bytes32 role = roles[i];
            uint256 share = poolRoleShares[pool][role];
            totalFixed += share;

            address recipient = poolRoleRecipients[pool][role];
            uint256 amount = (totalFeeAmount * share) / totalRatio;
            pendingBalances[recipient][token] += amount;
        }

        require(totalFixed + referRatio == totalRatio, "Share sum mismatch");

        if (refer != address(0) && referRatio > 0) {
            uint256 referAmount = (totalFeeAmount * referRatio) / totalRatio;
            pendingBalances[refer][token] += referAmount;
        }
    }

    // ============ User Claim ============

    function claimFee(address token) external {
        uint256 amount = pendingBalances[msg.sender][token];
        require(amount > 0, "Nothing to claim");
        pendingBalances[msg.sender][token] = 0;
        IERC20(token).transfer(msg.sender, amount);
    }

    /// @notice View the fee that a user can claim
    function getFee(address user, address token) external view returns (uint256) {
        return pendingBalances[user][token];
    }
}
