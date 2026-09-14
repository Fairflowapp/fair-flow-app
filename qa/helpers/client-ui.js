"use strict";

const { expect } = require("@playwright/test");
const { openBooking, openBookingSection } = require("./booking");

const FIXTURE = {
  salonId: "ffBookingQa",
  locationId: "qaLoc1",
  clientId: "qaAppointmentClient",
  firstName: "QA Appointment",
  lastName: "Client",
  displayName: "QA Appointment Client",
  email: "qa-appointment-client@fair-flow-staging.test",
  searchName: "QA Appointment",
};

async function openClients(page) {
  await openBooking(page);
  await openBookingSection(page, "clients");
  await page.locator("#ffBookingClientsRoot").waitFor({ state: "visible", timeout: 15000 });
  await page.locator("#ffCliSearch").waitFor({ state: "visible", timeout: 15000 });
}

async function closeProfile(page) {
  const profile = page.locator("#ffBookingClientProfile");
  if (!(await profile.isVisible().catch(() => false))) return;
  await profile.locator('[data-ff-clip="close"]').click();
  await profile.waitFor({ state: "hidden", timeout: 10000 });
}

async function searchClients(page, query) {
  const input = page.locator("#ffCliSearch");
  await input.fill("");
  await input.fill(query);
  await page.waitForTimeout(400);
}

async function waitForClientRow(page, clientId) {
  const row = page.locator('#ffBookingClientsRoot [data-ff-cli-id="' + clientId + '"]');
  await row.waitFor({ state: "visible", timeout: 20000 });
  return row;
}

async function openClientRow(page, clientId) {
  await page.locator('#ffBookingClientsRoot [data-ff-cli-id="' + clientId + '"]').click();
  await page.locator("#ffBookingClientProfile").waitFor({ state: "visible", timeout: 15000 });
  await expect(page.locator("#ffClipName")).toBeVisible();
}

async function readProfileHeader(page) {
  return page.evaluate(() => {
    const text = (id) => {
      const el = document.getElementById(id);
      return el ? String(el.textContent || "").replace(/\s+/g, " ").trim() : "";
    };
    return {
      name: text("ffClipName"),
      phone: text("ffClipPhone"),
      email: text("ffClipEmail"),
    };
  });
}

async function addClientThroughUi(page, fields) {
  await page.locator("#ffBookingClientsRoot [data-ff-cli-act=\"add\"]").click();
  await page.locator("#ffBookingClientDrawer").waitFor({ state: "visible", timeout: 10000 });
  await expect(page.locator("#ffCliDrawerTitle")).toContainText(/Add Client/i);
  await page.locator("#ffCliFirst").fill(fields.firstName);
  await page.locator("#ffCliLast").fill(fields.lastName);
  await page.locator("#ffCliPhone").fill(fields.phone);
  await page.locator("#ffCliEmail").fill(fields.email);
  await page.locator("#ffCliNotes").fill(fields.notes);
  await page.locator("#ffCliSave").click();
  await page.locator("#ffBookingClientDrawer").waitFor({ state: "hidden", timeout: 20000 }).catch(async () => {
    const err = await page.locator("#ffCliDrawerMsg").textContent().catch(() => "");
    throw new Error("Add Client drawer did not close. " + String(err || "").trim());
  });
  await page.locator("#ffBookingClientProfile").waitFor({ state: "visible", timeout: 15000 });
}

async function enterProfileEdit(page) {
  await page.locator('#ffBookingClientProfile [data-ff-clip="edit"]').click();
  await expect(page.locator("#ffClipEditForm")).toBeVisible();
}

async function saveProfileEdit(page) {
  await page.locator("#ffClipSave").click();
  await page.locator("#ffClipEditForm").waitFor({ state: "hidden", timeout: 20000 }).catch(async () => {
    const err = await page.locator("#ffClipMsg").textContent().catch(() => "");
    throw new Error("Profile edit did not leave the editor. " + String(err || "").trim());
  });
}

async function currentClientRows(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("#ffBookingClientsRoot [data-ff-cli-id]")).map((el) => ({
      clientId: el.getAttribute("data-ff-cli-id") || "",
      text: String(el.textContent || "").replace(/\s+/g, " ").trim(),
    }));
  });
}

module.exports = {
  FIXTURE,
  openClients,
  closeProfile,
  searchClients,
  waitForClientRow,
  openClientRow,
  readProfileHeader,
  addClientThroughUi,
  enterProfileEdit,
  saveProfileEdit,
  currentClientRows,
};
