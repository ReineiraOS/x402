import type { Metadata } from "next";
import { TwoKeyTheater } from "../components/TwoKeyTheater";

export const metadata: Metadata = {
  title: "The Two-Key Halt · ReineiraOS",
  description:
    "A security primitive on x402 rails — a Sentinel stakes a bond to raise an alarm, a Guardian freezes the vault, and an on-chain resolver settles the stake.",
};

export default function TwoKeyPage() {
  return (
    <div className="container page">
      <div className="page__head">
        <div>
          <span className="eyebrow">Portal showcase</span>
          <h1 className="page__title">The Two-Key Halt</h1>
          <p className="page__lead">
            A security primitive on x402 rails — a Sentinel stakes a bond to raise an alarm, a Guardian
            freezes the vault, and an on-chain resolver settles the stake.
          </p>
        </div>
      </div>

      <TwoKeyTheater />
    </div>
  );
}
