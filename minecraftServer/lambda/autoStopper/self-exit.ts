// itzg's auto-stop shuts the server down cleanly, so ECS records the container as having exited
// on its own with code 0. Deploys, Spot reclaims and manual stops have other stop codes, and
// crashes have other exit codes, so only a real auto-stop matches both
export const SELF_EXIT_STOP_CODE = 'EssentialContainerExited'
export const CLEAN_EXIT_CODE = 0
