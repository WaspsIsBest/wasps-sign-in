"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  onCancel: () => void;
  onCompleted: () => void | Promise<void>;
};

export default function WasraMemberForm({
  onCancel,
  onCompleted,
}: Props) {
  const [wasraNumber, setWasraNumber] = useState("");
  const [firstName, setFirstName] = useState("");
  const [surname, setSurname] = useState("");
  const [membershipType, setMembershipType] = useState("Senior");
  const [club, setClub] = useState("WASPS");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setBusy(true);
    setError("");

    try {
      const supabase = createClient();

      const { error: insertError } = await supabase
        .from("members")
        .insert({
          wasra_number: Number(wasraNumber),
          first_name: firstName.trim(),
          surname: surname.trim(),
          membership_type: membershipType,
          club,
          is_active: true,
          is_junior: membershipType === "Junior",
          can_be_official: true,
        });

      if (insertError) {
        throw insertError;
      }

      await onCompleted();
    } catch (err: any) {
      setError(err.message ?? "Unable to add member");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="result info">
      <div className="result-title">
        ADD MEMBER
      </div>

      <form onSubmit={handleSubmit}>
        <input
          className="scan-input"
          type="number"
          placeholder="WASRA Number"
          value={wasraNumber}
          onChange={(e) => setWasraNumber(e.target.value)}
          required
        />

        <input
          className="scan-input"
          type="text"
          placeholder="First Name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          required
        />

        <input
          className="scan-input"
          type="text"
          placeholder="Surname"
          value={surname}
          onChange={(e) => setSurname(e.target.value)}
          required
        />

        <select
          className="scan-input"
          value={membershipType}
          onChange={(e) => setMembershipType(e.target.value)}
        >
          <option value="Senior">Senior</option>
          <option value="Junior">Junior</option>
          <option value="Associate">Associate</option>
          <option value="Life">Life</option>
        </select>

        <select
          className="scan-input"
          value={club}
          onChange={(e) => setClub(e.target.value)}
        >
          <option value="WASPS">WASPS</option>
          <option value="Mandurah">Mandurah</option>
          <option value="Albany">Albany</option>
          <option value="Bunbury">Bunbury</option>
          <option value="Pinjar">Pinjar</option>
          <option value="Geraldton">Geraldton</option>
          <option value="Other">Other</option>
        </select>

        {error && (
          <div className="result error">
            <p>{error}</p>
          </div>
        )}

        <div className="actions">
          <button
            type="submit"
            className="primary"
            disabled={busy}
          >
            {busy ? "Saving..." : "Save Member"}
          </button>

          <button
            type="button"
            className="secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
