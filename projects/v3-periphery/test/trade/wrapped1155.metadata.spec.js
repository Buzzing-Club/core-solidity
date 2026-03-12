const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployCleanFixture } = require("../fixtures/cleanDeploy.fixture");

function createFixtureLoader() {
  let snapshotId;
  let value;
  return async (fixture) => {
    if (snapshotId === undefined) {
      value = await fixture();
      snapshotId = await ethers.provider.send("evm_snapshot", []);
      return value;
    }
    await ethers.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
    return value;
  };
}

function shortStringSlot(text) {
  const raw = ethers.utils.toUtf8Bytes(text);
  if (raw.length > 31) throw new Error("short string too long");
  const out = new Uint8Array(32);
  out.set(raw, 0);
  out[31] = raw.length * 2;
  return ethers.utils.hexlify(out);
}

function metadataPayloadSlotEncoded(name, symbol, decimals) {
  return ethers.utils.hexConcat([
    shortStringSlot(name),
    shortStringSlot(symbol),
    ethers.utils.hexZeroPad(ethers.utils.hexlify(decimals), 1),
  ]);
}

function metadataPayloadRawBytes32(name, symbol, decimals) {
  return ethers.utils.hexConcat([
    ethers.utils.formatBytes32String(name),
    ethers.utils.formatBytes32String(symbol),
    ethers.utils.hexZeroPad(ethers.utils.hexlify(decimals), 1),
  ]);
}

function computeDomainSeparator(name, chainId, verifyingContract) {
  const domainTypeHash = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
  );
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "bytes32", "bytes32", "uint256", "address"],
      [
        domainTypeHash,
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes(name)),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("1")),
        chainId,
        verifyingContract,
      ]
    )
  );
}

async function deployWrapped(factory, multiToken, tokenId, data) {
  await (await factory.requireWrapped1155(multiToken, tokenId, data)).wait();
  const wrappedAddr = await factory.getWrapped1155(multiToken, tokenId, data);
  const wrapped = await ethers.getContractAt("contracts/Wrapped1155Factory.sol:Wrapped1155", wrappedAddr);
  return wrapped;
}

describe("Wrapped1155 metadata / permit domain / decimals", function () {
  const loadFixture = createFixtureLoader();

  it("raw bytes32 metadata leads to abnormal name/symbol and impacts permit domain name hash", async function () {
    const ctx = await loadFixture(() => deployCleanFixture());
    const { wrapped1155Factory, ctf } = ctx.business;
    const intendedName = "BUBBLY";
    const intendedSymbol = "BUL";
    const rawPayload = metadataPayloadRawBytes32(intendedName, intendedSymbol, 6);

    const wrapped = await deployWrapped(wrapped1155Factory, ctf.address, 1001, rawPayload);
    const nameOnchain = await wrapped.name();
    const symbolOnchain = await wrapped.symbol();
    const domainOnchain = await wrapped.DOMAIN_SEPARATOR();
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const expectedFromIntended = computeDomainSeparator(intendedName, chainId, wrapped.address);
    const expectedFromOnchainName = computeDomainSeparator(nameOnchain, chainId, wrapped.address);

    console.log(
      `[wrapped1155][raw-bytes32] intendedName=${JSON.stringify(intendedName)} intendedSymbol=${JSON.stringify(
        intendedSymbol
      )} onchainName=${JSON.stringify(nameOnchain)} onchainSymbol=${JSON.stringify(symbolOnchain)}`
    );

    // At least one metadata field deviates from intended plaintext values.
    expect(nameOnchain === intendedName && symbolOnchain === intendedSymbol).to.equal(false);
    // DOMAIN_SEPARATOR follows actual on-chain name(), so mismatch against intended name hash.
    expect(domainOnchain).to.equal(expectedFromOnchainName);
    expect(domainOnchain).to.not.equal(expectedFromIntended);
  });

  it("decimals is controlled by payload byte 65 (not always zero)", async function () {
    const ctx = await loadFixture(() => deployCleanFixture());
    const { wrapped1155Factory, ctf } = ctx.business;

    const payload6 = metadataPayloadSlotEncoded("TokenSix", "TSIX", 6);
    const wrapped6 = await deployWrapped(wrapped1155Factory, ctf.address, 2001, payload6);
    console.log(
      `[wrapped1155][slot-encoded] onchainName=${JSON.stringify(await wrapped6.name())} onchainSymbol=${JSON.stringify(
        await wrapped6.symbol()
      )}`
    );
    expect(await wrapped6.decimals()).to.equal(6);

    const payload0 = metadataPayloadSlotEncoded("TokenZero", "TZRO", 0);
    const wrapped0 = await deployWrapped(wrapped1155Factory, ctf.address, 2002, payload0);
    console.log(
      `[wrapped1155][slot-encoded] onchainName=${JSON.stringify(await wrapped0.name())} onchainSymbol=${JSON.stringify(
        await wrapped0.symbol()
      )}`
    );
    expect(await wrapped0.decimals()).to.equal(0);
  });
});
