// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {HoodlumsTokenFactory} from "./HoodlumsTokenFactory.sol";
import {FixedSupplyMemeToken} from "./FixedSupplyMemeToken.sol";

interface Vm {
    function deal(address account, uint256 newBalance) external;
    function prank(address nextCaller) external;
}

contract FeeReceiver {
    receive() external payable {}
}

contract RejectingFeeReceiver {
    receive() external payable {
        revert("fee rejected");
    }
}

contract HoodlumsTokenFactoryTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant CREATOR = address(0xC0FFEE);
    address private constant RECIPIENT = address(0xBEEF);
    address private constant NEXT_OWNER = address(0xA11CE);

    FeeReceiver private feeReceiver;
    HoodlumsTokenFactory private factory;

    function setUp() public {
        feeReceiver = new FeeReceiver();
        factory = new HoodlumsTokenFactory(address(this), address(feeReceiver), 0);
    }

    function testFreeTestnetLaunchCreatesAndRecordsFixedSupplyToken() public {
        vm.prank(CREATOR);
        address tokenAddress = factory.launchToken(
            "City Journey",
            "RIDE",
            1_000_000_000,
            18,
            RECIPIENT
        );

        FixedSupplyMemeToken token = FixedSupplyMemeToken(tokenAddress);
        require(keccak256(bytes(token.name())) == keccak256(bytes("City Journey")), "wrong name");
        require(keccak256(bytes(token.symbol())) == keccak256(bytes("RIDE")), "wrong symbol");
        require(token.decimals() == 18, "wrong decimals");
        require(token.totalSupply() == 1_000_000_000 ether, "wrong total supply");
        require(token.balanceOf(RECIPIENT) == 1_000_000_000 ether, "recipient missing supply");

        require(factory.launchCount() == 1, "launch not counted");
        require(factory.creatorLaunchCount(CREATOR) == 1, "creator launch not counted");
        require(factory.isFactoryToken(tokenAddress), "token not verified by factory");

        HoodlumsTokenFactory.LaunchRecord memory record = factory.launchAt(0);
        require(record.token == tokenAddress, "wrong recorded token");
        require(record.creator == CREATOR, "wrong recorded creator");
        require(record.recipient == RECIPIENT, "wrong recorded recipient");
        require(record.wholeTokenSupply == 1_000_000_000, "wrong recorded supply");
        require(record.decimals == 18, "wrong recorded decimals");
        require(record.feePaid == 0, "testnet launch should be free");
        require(record.launchedAt > 0, "launch timestamp missing");
    }

    function testExactLaunchFeeIsForwardedImmediately() public {
        uint256 fee = 0.002 ether;
        factory.setLaunchFee(fee);
        vm.deal(CREATOR, fee);

        uint256 balanceBefore = address(feeReceiver).balance;
        vm.prank(CREATOR);
        address tokenAddress = factory.launchToken{value: fee}(
            "Fee Test",
            "FEE",
            1_000_000,
            6,
            CREATOR
        );

        require(address(feeReceiver).balance == balanceBefore + fee, "fee was not forwarded");
        require(address(factory).balance == 0, "factory retained launch fee");
        require(factory.launches(tokenAddress).feePaid == fee, "fee not recorded");
    }

    function testIncorrectLaunchFeeRevertsWithoutRecordingLaunch() public {
        uint256 fee = 0.002 ether;
        factory.setLaunchFee(fee);
        vm.deal(CREATOR, fee);

        vm.prank(CREATOR);
        (bool success, ) = address(factory).call{value: fee - 1}(
            abi.encodeCall(
                HoodlumsTokenFactory.launchToken,
                ("Wrong Fee", "WRONG", 1_000_000, 18, CREATOR)
            )
        );

        require(!success, "underpaid launch should revert");
        require(factory.launchCount() == 0, "failed launch was recorded");
    }

    function testFeeTransferFailureRevertsTheWholeLaunch() public {
        RejectingFeeReceiver rejectingReceiver = new RejectingFeeReceiver();
        uint256 fee = 0.001 ether;
        factory.setFeeRecipient(address(rejectingReceiver));
        factory.setLaunchFee(fee);
        vm.deal(CREATOR, fee);

        vm.prank(CREATOR);
        (bool success, ) = address(factory).call{value: fee}(
            abi.encodeCall(
                HoodlumsTokenFactory.launchToken,
                ("Atomic Launch", "ATOM", 10_000, 18, CREATOR)
            )
        );

        require(!success, "rejected fee should revert launch");
        require(factory.launchCount() == 0, "reverted launch was recorded");
        require(address(factory).balance == 0, "reverted fee remained in factory");
    }

    function testOnlyOwnerCanChangeFeePolicy() public {
        vm.prank(CREATOR);
        (bool feeSuccess, ) = address(factory).call(
            abi.encodeCall(HoodlumsTokenFactory.setLaunchFee, (0.001 ether))
        );
        require(!feeSuccess, "non-owner changed launch fee");

        vm.prank(CREATOR);
        (bool recipientSuccess, ) = address(factory).call(
            abi.encodeCall(HoodlumsTokenFactory.setFeeRecipient, (CREATOR))
        );
        require(!recipientSuccess, "non-owner changed fee recipient");
    }

    function testLaunchFeeCannotExceedHardCap() public {
        (bool success, ) = address(factory).call(
            abi.encodeCall(
                HoodlumsTokenFactory.setLaunchFee,
                (factory.MAX_LAUNCH_FEE() + 1)
            )
        );
        require(!success, "launch fee exceeded cap");
    }

    function testOwnershipTransferRequiresAcceptance() public {
        factory.transferOwnership(NEXT_OWNER);
        require(factory.owner() == address(this), "ownership changed before acceptance");
        require(factory.pendingOwner() == NEXT_OWNER, "pending owner missing");

        vm.prank(NEXT_OWNER);
        factory.acceptOwnership();
        require(factory.owner() == NEXT_OWNER, "new owner did not accept ownership");

        (bool oldOwnerSuccess, ) = address(factory).call(
            abi.encodeCall(HoodlumsTokenFactory.setLaunchFee, (1))
        );
        require(!oldOwnerSuccess, "old owner retained admin access");

        vm.prank(NEXT_OWNER);
        factory.setLaunchFee(1);
        require(factory.launchFee() == 1, "new owner cannot manage factory");
    }

    function testDirectNativePaymentsAreRejected() public {
        vm.deal(address(this), 1 ether);
        (bool success, ) = address(factory).call{value: 1}("");
        require(!success, "direct payment should revert");
        require(address(factory).balance == 0, "factory accepted direct payment");
    }

    receive() external payable {}
}