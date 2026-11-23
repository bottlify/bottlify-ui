/*
 * Copyright © 2026 Bottlify Project
 * Licensed under the Mozilla Public License, version 2.0
 * See LICENSE for details
 */

import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, Radio, TextField, Typography,
} from "@mui/material";
import { useState } from "react";
import { sendFeedback } from "../api/feedback.js";
import { useT } from "../i18n.js";
import { INK } from "../theme.js";
import { DialogHead } from "./kit.jsx";

/** @typedef {{ id: string, title: string, store: string | null }} FeedbackGame */

/**
 * What a sent rating or report ends in: closed once sent, or said plainly that
 * it was not, with the dialog left open so the words are not lost.
 *
 * @param {(message: import("../api/feedback.js").Feedback) => void} done
 */
function useSending(done) {
  const [state, setState] = useState(/** @type {"idle" | "sending" | "unsent"} */ ("idle"));
  /** @param {import("../api/feedback.js").Feedback} message */
  const send = async (message) => {
    setState("sending");
    const { sent } = await sendFeedback(message).catch(() => ({ sent: false }));
    if (sent) done(message);
    else setState("unsent");
  };
  return { state, send };
}

/**
 * How a game runs for this person: one of the three statuses the library shows,
 * and what gets in the way.
 *
 * @param {Object} props
 * @param {FeedbackGame} props.game
 * @param {() => void} props.onClose
 */
export function RateDialog({ game, onClose }) {
  const t = useT();
  const [status, setStatus] = useState(/** @type {"works" | "issues" | "fails" | null} */ (null));
  const [comment, setComment] = useState("");
  const { state, send } = useSending(onClose);
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogHead title={t("rate.title", { name: game.title })} subtitle={t("rate.subtitle")}
        onClose={onClose} closeLabel={t("button.close")} />
      <DialogContent sx={{ px: 4 }}>
        <Box role="radiogroup" sx={{ display: "grid", gap: 1.25 }}>
          {/** @type {const} */ (["works", "issues", "fails"]).map((one) => (
            <Box component="label" key={one} sx={{
              display: "flex", gap: 2, alignItems: "flex-start", p: 2, borderRadius: "9px", cursor: "pointer",
              border: "1px solid", borderColor: status === one ? "text.primary" : "divider",
              bgcolor: status === one ? INK.raised : "transparent",
            }}>
              <Radio checked={status === one} onChange={() => setStatus(one)} value={one}
                sx={{ p: 0, mt: 0.25, color: "text.secondary", "&.Mui-checked": { color: "text.primary" } }} />
              <Box>
                <Typography sx={{ fontWeight: 600 }}>{t(`rate.${one}`)}</Typography>
                <Typography variant="body2" color="text.secondary">{t(`rate.${one}Text`)}</Typography>
              </Box>
            </Box>
          ))}
        </Box>
        <TextField fullWidth multiline minRows={3} label={t("rate.comment")} value={comment}
          placeholder={t("rate.commentHint")} onChange={(event) => setComment(event.target.value)}
          sx={{ mt: 3 }} slotProps={{ inputLabel: { shrink: true } }} />
        {state === "unsent" && <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>{t("feedback.unsent")}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 4, borderTop: "1px solid", borderColor: "divider" }}>
        <Button variant="contained" disabled={!status || state === "sending"}
          onClick={() => status && send({ kind: "rating", game, status, comment: comment.trim() })}>
          {t("rate.send")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * A run that stopped, reported: what the person was doing, and the list of
 * what the report carries, so nothing goes that they were not told about.
 *
 * @param {Object} props
 * @param {FeedbackGame} props.game
 * @param {string} props.store  The store's name as a person knows it, or the kind of game.
 * @param {() => Record<string, unknown>} props.details  What the report carries beside the words.
 * @param {() => void} props.onClose
 */
export function ReportDialog({ game, store, details, onClose }) {
  const t = useT();
  const [comment, setComment] = useState("");
  const { state, send } = useSending(onClose);
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth sx={{ zIndex: 1400 }}>
      <DialogHead title={t("report.title")} subtitle={t("report.subtitle")} onClose={onClose}
        closeLabel={t("button.close")} />
      <DialogContent sx={{ px: 4 }}>
        <TextField fullWidth multiline minRows={3} label={t("report.what")} value={comment}
          placeholder={t("report.whatHint")} helperText={t("report.optional")}
          onChange={(event) => setComment(event.target.value)} slotProps={{ inputLabel: { shrink: true } }}
          sx={{ mt: 1 }} />
        <Box sx={{ mt: 2, p: 2, borderRadius: "9px", bgcolor: INK.ground, color: "text.secondary", fontSize: 14 }}>
          {t("report.contents", { name: game.title, store })}
        </Box>
        {state === "unsent" && <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>{t("feedback.unsent")}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 4, borderTop: "1px solid", borderColor: "divider" }}>
        <Button variant="contained" disabled={state === "sending"}
          onClick={() => send({ kind: "report", game, comment: comment.trim(), details: details() })}>
          {t("report.send")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
