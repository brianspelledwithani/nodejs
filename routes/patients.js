const express = require("express");
const router = express.Router();
const { pool } = require("./db");

/**
 * Helper: normalize a phone number to digits only.
 * Authorizer stores phone_number like: 9154746142
 */
function phoneToDigits(phone) {
  return String(phone || "").replace(/\D/g, "");
}

/**
 * POST /api/patients
 * (Logged-in flow later)
 * For now it expects provider_id to be provided in the request body.
 */
router.post("/", async (req, res) => {
  try {
    const {
      // REQUIRED (for now we pass it in; later we’ll pull from Authorizer token)
      provider_id,
      name,
      dateOfBirth,
      mobile,

      // OPTIONAL
      email,
      isiScore,

      // Treatment flags (booleans)
      tx_cbti = false,
      tx_cpap_comisa = false,
      tx_sleep_eeg = false,
      tx_zepbound_osa = false,
      tx_natural_products = false,
      tx_insomnia_meds_mgmt = false,
    } = req.body || {};

    if (!provider_id) return res.status(400).json({ error: "provider_id is required" });
    if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });
    if (!dateOfBirth) return res.status(400).json({ error: "dateOfBirth is required" });
    if (!mobile || !mobile.trim()) return res.status(400).json({ error: "mobile is required" });

    const isi =
      isiScore === "" || isiScore === null || isiScore === undefined
        ? null
        : Number(isiScore);

    if (isi !== null && (!Number.isFinite(isi) || isi < 0 || isi > 28)) {
      return res.status(400).json({ error: "isiScore must be 0-28" });
    }

    const result = await pool.query(
      `
      INSERT INTO patients (
        provider_id,
        full_name,
        date_of_birth,
        mobile,
        email,
        isi_score,
        tx_cbti,
        tx_cpap_comisa,
        tx_sleep_eeg,
        tx_zepbound_osa,
        tx_natural_products,
        tx_insomnia_meds_mgmt
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,$11,$12
      )
      RETURNING id
      `,
      [
        provider_id,
        name.trim(),
        dateOfBirth, // expects YYYY-MM-DD
        mobile.trim(),
        (email || "").trim() || null,
        isi,
        Boolean(tx_cbti),
        Boolean(tx_cpap_comisa),
        Boolean(tx_sleep_eeg),
        Boolean(tx_zepbound_osa),
        Boolean(tx_natural_products),
        Boolean(tx_insomnia_meds_mgmt),
      ]
    );

    return res.status(201).json({ patientId: result.rows[0].id, status: "created" });
  } catch (err) {
    console.error("POST /api/patients error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/patients/public
 * Public flow: provider can add patients WITHOUT signing in.
 * We accept providerPhone, look up provider_id from authorizer_users.phone_number,
 * then insert patient under that provider_id.
 *
 * Body: { providerPhone, name, dateOfBirth, mobile, email, isiScore, tx_* booleans... }
 */
router.post("/public", async (req, res) => {
  try {
    const {
      providerPhone,
      name,
      dateOfBirth,
      mobile,

      email,
      isiScore,

      tx_cbti = false,
      tx_cpap_comisa = false,
      tx_sleep_eeg = false,
      tx_zepbound_osa = false,
      tx_natural_products = false,
      tx_insomnia_meds_mgmt = false,
    } = req.body || {};

    if (!providerPhone || !String(providerPhone).trim()) {
      return res.status(400).json({ error: "providerPhone is required" });
    }
    if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });
    if (!dateOfBirth) return res.status(400).json({ error: "dateOfBirth is required" });
    if (!mobile || !mobile.trim()) return res.status(400).json({ error: "mobile is required" });

    const providerPhoneDigits = phoneToDigits(providerPhone);

    // Find provider in Authorizer by phone_number
    const providerResult = await pool.query(
      `SELECT id FROM authorizer_users WHERE phone_number = $1 LIMIT 1`,
      [providerPhoneDigits]
    );

    if (providerResult.rowCount === 0) {
      return res.status(404).json({ error: "Provider not found for that phone number" });
    }

    const provider_id = providerResult.rows[0].id; // Authorizer user id (TEXT)

    const isi =
      isiScore === "" || isiScore === null || isiScore === undefined
        ? null
        : Number(isiScore);

    if (isi !== null && (!Number.isFinite(isi) || isi < 0 || isi > 28)) {
      return res.status(400).json({ error: "isiScore must be 0-28" });
    }

    const result = await pool.query(
      `
      INSERT INTO patients (
        provider_id,
        full_name,
        date_of_birth,
        mobile,
        email,
        isi_score,
        tx_cbti,
        tx_cpap_comisa,
        tx_sleep_eeg,
        tx_zepbound_osa,
        tx_natural_products,
        tx_insomnia_meds_mgmt
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,$11,$12
      )
      RETURNING id
      `,
      [
        provider_id,
        name.trim(),
        dateOfBirth,
        mobile.trim(),
        (email || "").trim() || null,
        isi,
        Boolean(tx_cbti),
        Boolean(tx_cpap_comisa),
        Boolean(tx_sleep_eeg),
        Boolean(tx_zepbound_osa),
        Boolean(tx_natural_products),
        Boolean(tx_insomnia_meds_mgmt),
      ]
    );

    return res.status(201).json({ patientId: result.rows[0].id, status: "created" });
  } catch (err) {
    console.error("POST /api/patients/public error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
