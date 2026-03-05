// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MerkleProof.sol";

/**
 * @title CumulativeMerkleClaim
 * @notice Cumulative Merkle-based commission/airdrop claim contract
 *
 * Users can repeatedly claim the difference between:
 * - the latest off-chain calculated cumulative amount
 * - and the amount they have already claimed on-chain
 *
 * The Merkle root can be updated periodically (e.g. daily).
 */
interface IERC20 {
    function transfer(address recipient, uint256 amount) external returns (bool);
}

contract CumulativeMerkleClaim {
    /// @notice Contract owner (set at deployment)
    address public owner;

    /// @notice ERC20 token used for commission distribution
    IERC20 public immutable token;

    /// @notice Current active Merkle root (updated periodically)
    bytes32 public merkleRoot;

    /// @notice Total amount already claimed by each user
    mapping(address => uint256) public claimed;

    /// @notice Emitted when a user successfully claims tokens
    event Claimed(address indexed user, uint256 amount);

    /// @notice Emitted when the Merkle root is updated
    event MerkleRootUpdated(bytes32 oldRoot, bytes32 newRoot);

    /// @notice Emitted when ownership is transferred
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    /**
     * @param _token ERC20 token address
     * @param _initialRoot Initial Merkle root
     */
    constructor(address _token, bytes32 _initialRoot) {
        owner = msg.sender;
        token = IERC20(_token);
        merkleRoot = _initialRoot;

        emit OwnershipTransferred(address(0), msg.sender);
    }

    /**
     * @notice Claim commission tokens (only the incremental amount)
     * @param cumulativeAmount Off-chain computed cumulative claimable amount
     * @param proof Merkle proof validating (msg.sender, cumulativeAmount)
     *
     * The contract will transfer:
     * cumulativeAmount - alreadyClaimed
     */
    function claim(
        uint256 cumulativeAmount,
        bytes32[] calldata proof
    ) external {
        uint256 alreadyClaimed = claimed[msg.sender];
        require(cumulativeAmount > alreadyClaimed, "Nothing to claim");

        // Verify Merkle proof
        bytes32 leaf = keccak256(
            abi.encodePacked(msg.sender, cumulativeAmount)
        );

        require(
            MerkleProof.verify(proof, merkleRoot, leaf),
            "Invalid proof"
        );

        uint256 claimAmount = cumulativeAmount - alreadyClaimed;
        claimed[msg.sender] = cumulativeAmount;

        require(
            token.transfer(msg.sender, claimAmount),
            "Transfer failed"
        );

        emit Claimed(msg.sender, claimAmount);
    }

    /**
     * @notice Update the Merkle root (e.g. daily/hourly)
     */
    function updateMerkleRoot(bytes32 newRoot) external onlyOwner {
        emit MerkleRootUpdated(merkleRoot, newRoot);
        merkleRoot = newRoot;
    }

    /**
     * @notice Withdraw excess tokens from the contract
     */
    function withdraw(address to, uint256 amount) external onlyOwner {
        require(token.transfer(to, amount), "Withdraw failed");
    }

    /**
     * @notice Transfer ownership to a new address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
