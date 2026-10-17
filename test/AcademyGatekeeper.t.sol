// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AcademyGatekeeper} from "../contracts/AcademyGatekeeper.sol";

interface Vm {
    function warp(uint256 newTimestamp) external;
}

/// Llama al portero como si fuera otra wallet.
contract Student {
    AcademyGatekeeper immutable gate;

    constructor(AcademyGatekeeper gate_) {
        gate = gate_;
    }

    function enter() external {
        gate.enter();
    }

    function start(uint8 boss) external {
        gate.startAttempt(boss);
    }

    function finish(uint8 boss, uint8 score) external {
        gate.completeBoss(boss, score);
    }
}

contract AcademyGatekeeperTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    AcademyGatekeeper gate;
    Student ada;
    Student bob;

    function setUp() public {
        gate = new AcademyGatekeeper();
        ada = new Student(gate);
        bob = new Student(gate);
    }

    function testEnterIsIdempotent() public {
        ada.enter();
        (uint64 at,,,) = gate.profileOf(address(ada));
        require(at != 0, "sin fecha de matricula");
        vm.warp(block.timestamp + 3 days);
        ada.enter();
        (uint64 again,,,) = gate.profileOf(address(ada));
        require(again == at, "la matricula no debe reescribirse");
    }

    function testAttemptRequiresEnrollment() public {
        try ada.start(0) {
            require(false, "un intento sin matricula debio revertir");
        } catch {}
    }

    function testUnknownBossAndBadScore() public {
        ada.enter();
        try ada.start(3) {
            require(false, "jefe desconocido");
        } catch {}
        try ada.finish(0, 101) {
            require(false, "nota imposible");
        } catch {}
        try ada.finish(9, 50) {
            require(false, "jefe 9");
        } catch {}
        (, uint8 badges, uint32 attempts, uint8[3] memory best) = gate.profileOf(address(ada));
        require(badges == 0 && attempts == 0 && best[0] == 0, "un revert no debe dejar rastro");
    }

    function testBadgeIsCountedOnceAndKeepsBestScore() public {
        ada.enter();
        ada.start(0);
        ada.finish(0, 40);
        ada.finish(0, 90);
        ada.finish(0, 10);
        ada.start(1);
        ada.finish(1, 100);
        ada.start(2);
        ada.finish(2, 70);

        require(gate.hasBadge(address(ada), 0), "jefe 0");
        require(gate.hasBadge(address(ada), 1), "jefe 1");
        require(gate.hasBadge(address(ada), 2), "jefe 2");
        require(!gate.hasBadge(address(bob), 0), "bob no peleo");

        (uint64 at, uint8 badges, uint32 attempts, uint8[3] memory best) = gate.profileOf(address(ada));
        require(at != 0, "matriculada");
        require(badges == 7, "bits 0+1+2");
        require(attempts == 3, "tres peleas");
        require(best[0] == 90, "la nota baja no pisa la mejor");
        require(best[1] == 100, "nota 1");
        require(best[2] == 70, "nota 2");
        require(gate.minted(0) == 1, "la insignia se cuenta una vez");
        require(gate.minted(1) == 1, "insignia 1");
        require(gate.minted(2) == 1, "insignia 2");
    }

    function testProfilesStaySeparate() public {
        ada.enter();
        bob.enter();
        ada.finish(2, 80);
        require(gate.hasBadge(address(ada), 2), "ada");
        require(!gate.hasBadge(address(bob), 2), "bob");
        (, uint8 adaBadges,,) = gate.profileOf(address(ada));
        (, uint8 bobBadges, uint32 bobAttempts,) = gate.profileOf(address(bob));
        require(adaBadges == 4, "solo el bit del jefe 2");
        require(bobBadges == 0, "bob sin insignia");
        require(bobAttempts == 0, "bob sin intentos");
    }

    function testHasBadgeRejectsUnknownBoss() public {
        try gate.hasBadge(address(ada), 3) returns (bool) {
            require(false, "jefe 3 no existe");
        } catch {}
    }
}
