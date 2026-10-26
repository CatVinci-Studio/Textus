/**
 * The reply of an exchange that ran out of tool steps before finishing. Must
 * match aicompat's OUT_OF_STEPS (a Rust test reads this file).
 */
export const OUT_OF_STEPS =
  "(Stopped at the step limit before finishing. Ask me to continue, or narrow the request.)";
