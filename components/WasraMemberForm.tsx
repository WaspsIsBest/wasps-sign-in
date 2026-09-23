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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setBusy(true);
    setError("");

    try {
      const supabase = createClient();

      const { error } = await supabase
        .from("members")
        .insert({
          wasra_number: Number(wasraNumber),
          first_name: firstName.trim(),
          surname: surname.trim(),
          membership_type: membershipType,
          club: "WASRA",
          is_active: true,
        });

      if (error) throw error;

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
        ADD WASRA MEMBER
      </div>

      <form onSubmit={submit}>
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
          placeholder="First Name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          required
        />

        <input
          className="scan-input"
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

        {error !== "" && (
          <p className="muted">{error}</p>
        )}

        <div className="actions">
          <button
            className="primary"
            type="submit"
            disabled={busy}
          >
            {busy ? "Saving..." : "Save"}
          </button>

          <button
            className="secondary"
            type="button"
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
