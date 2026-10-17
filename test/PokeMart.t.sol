// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PokeMart} from "../contracts/PokeMart.sol";

interface Vm {
    function deal(address who, uint256 amount) external;
    function prank(address sender) external;
    function expectRevert(bytes calldata data) external;
}

/// Tesorería que rechaza pagos: para comprobar que una compra no se queda a medias.
contract Wall {
    receive() external payable {
        revert("no");
    }
}

contract PokeMartTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    PokeMart mart;
    address payable treasury = payable(address(uint160(uint256(keccak256("treasury")))));
    address ada = address(0xA11CE);

    function setUp() public {
        mart = new PokeMart(treasury);
        vm.deal(ada, 10 ether);
    }

    function test_buyForwardsToTreasuryAndCounts() public {
        uint256 cost = mart.price(1) * 2;
        uint256 before = treasury.balance;
        vm.prank(ada);
        uint256 id = mart.buy{value: cost}(1, 2);
        require(id == 1, "order id");
        require(treasury.balance == before + cost, "treasury paid");
        require(address(mart).balance == 0, "mart keeps nothing");
        require(mart.spentBy(ada) == cost, "spent");
        require(mart.ordersBy(ada) == 1, "orders");
    }

    function test_wrongValueReverts() public {
        uint256 cost = mart.price(0);
        vm.prank(ada);
        vm.expectRevert(abi.encodeWithSelector(PokeMart.WrongValue.selector, cost, cost - 1));
        mart.buy{value: cost - 1}(0, 1);
    }

    function test_unknownItemAndCount() public {
        vm.prank(ada);
        vm.expectRevert(abi.encodeWithSelector(PokeMart.UnknownItem.selector, uint8(8)));
        mart.buy{value: 1}(8, 1);
        vm.prank(ada);
        vm.expectRevert(abi.encodeWithSelector(PokeMart.BadCount.selector, uint8(0)));
        mart.buy{value: 0}(0, 0);
    }

    function test_pausedAndOwnerOnly() public {
        vm.prank(ada);
        vm.expectRevert(abi.encodeWithSelector(PokeMart.NotOwner.selector));
        mart.setPaused(true);
        mart.setPaused(true);
        uint256 cost = mart.price(0);
        vm.prank(ada);
        vm.expectRevert(abi.encodeWithSelector(PokeMart.IsPaused.selector));
        mart.buy{value: cost}(0, 1);
    }

    function test_rejectingTreasuryRevertsWholePurchase() public {
        PokeMart m = new PokeMart(payable(address(new Wall())));
        uint256 cost = m.price(0);
        vm.prank(ada);
        vm.expectRevert(abi.encodeWithSelector(PokeMart.PayoutFailed.selector));
        m.buy{value: cost}(0, 1);
        require(m.orders() == 0, "no order recorded");
    }
}
