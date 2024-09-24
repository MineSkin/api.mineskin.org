import { String } from "runtypes";

export const UUID = String.withConstraint(s => s.length === 36 || s.length === 32);