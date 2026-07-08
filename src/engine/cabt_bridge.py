from __future__ import annotations

import importlib.util
import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any, Callable


FRONTEND_ROOT = Path(__file__).resolve().parents[2]
WORKSPACE_ROOT = FRONTEND_ROOT.parent
SAMPLE_SUBMISSION = Path(
    os.environ.get(
        "CABT_SAMPLE_SUBMISSION_DIR",
        FRONTEND_ROOT / "sample_submission",
    )
).resolve()
sys.path.insert(0, str(SAMPLE_SUBMISSION))

from cg.api import all_attack, all_card_data  # noqa: E402
from cg.game import battle_finish, battle_select, battle_start  # noqa: E402


AgentFn = Callable[[dict[str, Any]], list[int]]
MAX_AUTO_STEPS = 10000


def to_jsonable(value: Any) -> Any:
    if hasattr(value, "__dataclass_fields__"):
        return {field: to_jsonable(getattr(value, field)) for field in value.__dataclass_fields__}
    if isinstance(value, list):
        return [to_jsonable(item) for item in value]
    if hasattr(value, "value"):
        return value.value
    return value


def first_legal_agent(obs: dict[str, Any]) -> list[int]:
    select = obs.get("select")
    if select is None:
        raise RuntimeError("The bridge expected preselected decks before battle start.")
    return list(range(select["maxCount"]))


def load_agent(agent_path: str | None) -> tuple[AgentFn, Callable | None]:
    """Returns (agent, set_deck). set_deck is an optional module hook
    called as set_deck(deck, seat) before battle start so deck-general
    agents can condition on whatever deck their seat was given."""
    if not agent_path:
        return first_legal_agent, None

    raw_path = Path(agent_path)
    if raw_path.is_absolute():
        path = raw_path.resolve()
    else:
        frontend_path = (FRONTEND_ROOT / raw_path).resolve()
        path = frontend_path if frontend_path.exists() else (WORKSPACE_ROOT / raw_path).resolve()
    if not path.exists():
        raise FileNotFoundError(f"Agent file not found: {path}")

    old_cwd = Path.cwd()
    sys.path.insert(0, str(path.parent))
    try:
        os.chdir(path.parent)
        module_name = f"cabt_agent_{abs(hash(str(path)))}"
        spec = importlib.util.spec_from_file_location(module_name, path)
        if spec is None or spec.loader is None:
            raise ImportError(f"Could not import agent: {path}")
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
    finally:
        os.chdir(old_cwd)
        try:
            sys.path.remove(str(path.parent))
        except ValueError:
            pass

    agent = getattr(module, "agent", None)
    if not callable(agent):
        raise AttributeError(f"{path} does not export callable agent(obs)")
    set_deck = getattr(module, "set_deck", None)
    return agent, set_deck if callable(set_deck) else None


class Session:
    def __init__(self) -> None:
        self.obs: dict[str, Any] | None = None
        self.agents: list[AgentFn] = [first_legal_agent, first_legal_agent]
        self.agent_controlled = [False, True]
        self.active = False

    def start(
        self,
        deck0: list[int],
        deck1: list[int],
        agent_paths: list[str | None],
        agent_controlled: list[bool],
    ) -> dict[str, Any]:
        self.close()
        self.agent_controlled = normalize_agent_controlled(agent_controlled)
        loaded = [load_agent(path) for path in normalize_agent_paths(agent_paths)]
        self.agents = [agent for agent, _ in loaded]
        for seat, (deck, (_, set_deck)) in enumerate(zip((deck0, deck1), loaded)):
            if set_deck is not None:
                set_deck(list(deck), seat)
        obs, start_data = battle_start(deck0, deck1)
        if obs is None or not start_data.battlePtr:
            return {
                "ok": False,
                "error": (
                    "battle_start failed: "
                    f"errorPlayer={start_data.errorPlayer}, errorType={start_data.errorType}"
                ),
            }

        self.obs = obs
        self.active = True
        auto_steps, auto_actions = self.play_ai_turns()
        return self.snapshot([obs, *auto_steps], [None, *auto_actions])

    def select(self, selection: list[int]) -> dict[str, Any]:
        if not self.active:
            raise RuntimeError("No active CABT battle.")
        selected_step = battle_select(selection)
        self.obs = selected_step
        auto_steps, auto_actions = self.play_ai_turns()
        return self.snapshot([selected_step, *auto_steps], [list(selection), *auto_actions])

    def state(self) -> dict[str, Any]:
        return self.snapshot()

    def play_ai_turns(self) -> tuple[list[dict[str, Any]], list[list[int]]]:
        auto_steps: list[dict[str, Any]] = []
        auto_actions: list[list[int]] = []
        for _ in range(MAX_AUTO_STEPS):
            if not self.obs:
                return auto_steps, auto_actions
            current = self.obs.get("current")
            select = self.obs.get("select")
            if not current or current.get("result", -1) >= 0 or select is None:
                return auto_steps, auto_actions
            player_index = current.get("yourIndex")
            if player_index not in (0, 1) or not self.agent_controlled[player_index]:
                return auto_steps, auto_actions
            action = self.agents[player_index](self.obs)
            self.obs = battle_select(action)
            auto_steps.append(self.obs)
            auto_actions.append(list(action))
        raise RuntimeError(f"AI auto-play limit exceeded ({MAX_AUTO_STEPS} selections).")

    def snapshot(
        self,
        auto_steps: list[dict[str, Any]] | None = None,
        auto_actions: list[list[int] | None] | None = None,
    ) -> dict[str, Any]:
        return {
            "ok": True,
            "observation": self.obs,
            "autoSteps": auto_steps or [],
            # autoActions[i] is the selection that produced autoSteps[i]
            # (None for an initial observation nothing acted on).
            "autoActions": auto_actions or [],
            "cards": [to_jsonable(card) for card in all_card_data()],
            "attacks": [to_jsonable(attack) for attack in all_attack()],
        }

    def close(self) -> None:
        if self.active:
            try:
                battle_finish()
            except Exception:
                pass
        self.obs = None
        self.agent_controlled = [False, True]
        self.active = False


def normalize_agent_paths(agent_paths: Any) -> list[str | None]:
    if not isinstance(agent_paths, list):
        return [None, None]
    return [
        agent_paths[0] if len(agent_paths) > 0 and isinstance(agent_paths[0], str) else None,
        agent_paths[1] if len(agent_paths) > 1 and isinstance(agent_paths[1], str) else None,
    ]


def normalize_agent_controlled(agent_controlled: Any) -> list[bool]:
    if not isinstance(agent_controlled, list):
        return [False, True]
    return [
        bool(agent_controlled[0]) if len(agent_controlled) > 0 else False,
        bool(agent_controlled[1]) if len(agent_controlled) > 1 else True,
    ]


def handle(session: Session, message: dict[str, Any]) -> dict[str, Any]:
    command = message.get("command")
    if command == "start":
        agent_paths = message.get("agentPaths")
        agent_controlled = message.get("agentControlled")
        if not isinstance(agent_paths, list):
            agent_paths = [None, message.get("agentPath")]
        if not isinstance(agent_controlled, list):
            agent_controlled = [False, not bool(message.get("manualOpponent"))]
        return session.start(
            message["deck0"],
            message["deck1"],
            agent_paths,
            agent_controlled,
        )
    if command == "select":
        return session.select(message["selection"])
    if command == "state":
        return session.state()
    if command == "close":
        session.close()
        return {"ok": True}
    raise ValueError(f"Unknown bridge command: {command}")


def main() -> None:
    # Protocol writes own the real stdout. Everything else that writes to
    # fd 1 — agent print() calls, native engine output — is redirected to
    # stderr, so a stray write can never corrupt or interleave with a
    # protocol line (an agent print without a trailing newline used to glue
    # itself to the next response and hang the caller forever).
    protocol = os.fdopen(os.dup(sys.stdout.fileno()), "w")
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    session = Session()
    for line in sys.stdin:
        message: dict[str, Any] = {}
        try:
            parsed = json.loads(line)
            message = parsed if isinstance(parsed, dict) else {}
            response = handle(session, message)
        except Exception as error:
            response = {
                "ok": False,
                "error": str(error),
                "traceback": traceback.format_exc(),
            }
        response["id"] = message.get("id")
        print(json.dumps(response, ensure_ascii=False), file=protocol, flush=True)


if __name__ == "__main__":
    main()
