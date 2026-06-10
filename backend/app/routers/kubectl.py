import os
import shlex
import subprocess

from fastapi import APIRouter, HTTPException

from app.models.schemas import KubectlRequest

router = APIRouter()

BLOCKED_SUBCOMMANDS = {"attach", "cp", "delete", "edit", "exec", "port-forward", "proxy"}
SHELL_TOKENS = {";", "&&", "||", "|", "`", "$(", ">", "<"}
MUTATING_SUBCOMMANDS = {"apply", "annotate", "label", "rollout", "scale", "set"}


@router.post("/run")
def run_kubectl(req: KubectlRequest):
    command = req.command.strip()
    if not command:
        raise HTTPException(status_code=400, detail="Command is required.")

    if any(token in command for token in SHELL_TOKENS):
        raise HTTPException(status_code=400, detail="Shell operators are not supported. Run one kubectl command at a time.")

    try:
        args = shlex.split(command)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid command: {exc}") from exc

    if not args or args[0] != "kubectl":
        raise HTTPException(status_code=400, detail="Only kubectl commands are allowed.")

    subcommand = args[1] if len(args) > 1 else ""
    if subcommand in BLOCKED_SUBCOMMANDS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"kubectl {subcommand} is interactive or unsafe for the web terminal. "
                "Use get/describe/logs/apply/rollout/scale commands instead."
            ),
        )

    if subcommand in MUTATING_SUBCOMMANDS and os.getenv("KUBECTL_TERMINAL_ALLOW_MUTATIONS", "true").lower() != "true":
        raise HTTPException(status_code=403, detail="Mutating kubectl commands are disabled by backend policy.")

    try:
        completed = subprocess.run(
            args,
            input=req.stdin or None,
            capture_output=True,
            text=True,
            timeout=int(os.getenv("KUBECTL_TERMINAL_TIMEOUT_SECONDS", "30")),
            check=False,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="kubectl is not installed in the backend image.") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=408, detail="kubectl command timed out.") from exc

    return {
        "command": command,
        "exit_code": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }
