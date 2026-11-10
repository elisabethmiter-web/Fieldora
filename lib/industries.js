"use strict";
// Trade presets. A business picks one at setup; everything stays editable in Business settings.
// Job type slots are fixed internally (pm, repair, install, assess, shop) so data stays compatible:
//   pm      = recurring maintenance (rolls the customer's next-due date forward)
//   repair  = service / repair call
//   install = installation
//   assess  = estimate / quote / site visit
//   shop    = bring-in or pickup work tracked on the "shop" board (stored as type "portable")

const ck = labels => labels.map((label, i) => ({ id: `chk${i + 1}`, label, type: "check" }));
const num = (id, label, unit) => ({ id, label, type: "number", unit });
const closing = () => ({ id: "work", title: "Work and recommendations", fields: [
  { id: "workDone", label: "Work performed", type: "textarea" },
  { id: "parts", label: "Parts and materials used", type: "textarea" },
  { id: "recommendations", label: "Recommendations for the customer", type: "textarea" },
] });
const serviceForm = (title, readings) => ({ id: "service", name: "Service call", title, sections: [
  ...(readings.length ? [{ id: "readings", title: "Readings", fields: readings }] : []),
  { id: "problem", title: "Problem", fields: [{ id: "complaint", label: "Customer’s description of the problem", type: "textarea" }, { id: "cause", label: "Cause found", type: "textarea" }] },
  closing(),
] });
const estimateForm = (title) => ({ id: "estimate", name: "Estimate visit", title, sections: [
  { id: "site", title: "Site details", fields: [{ id: "scope", label: "What the customer wants", type: "textarea" }, { id: "measurements", label: "Measurements and site notes", type: "textarea" }, { id: "access", label: "Access issues", type: "text" }] },
  { id: "work", title: "Next steps", fields: [{ id: "recommendations", label: "Recommendations for the customer", type: "textarea" }, { id: "followup", label: "Quote to follow by", type: "date" }] },
] });

const PRESETS = {
  generator: {
    name: "Generator service",
    equipment: "Generator", sizeUnit: "kW",
    fuels: ["Natural gas", "Propane", "Diesel", "Gasoline (portable)"],
    equipmentTypes: ["Standby generator", "Portable generator", "Transfer switch"],
    brands: ["Generac", "Briggs & Stratton", "Kohler", "Cummins", "Perkins", "Champion", "Honda"],
    jobTypes: { pm: { label: "Maintenance", on: true }, repair: { label: "Repair", on: true }, install: { label: "Install", on: true }, assess: { label: "Sizing visit", on: true }, shop: { label: "Portable pickup", on: true, board: "Portables in shop" } },
    forms: () => ({
      templates: [
        { id: "maintenance", name: "Maintenance", title: "Generator Maintenance Report", sections: [
          { id: "readings", title: "Readings", fields: [num("runHours", "Engine hours", "hrs"), num("batteryVoltage", "Battery voltage", "V"), num("outputVoltage", "Output voltage", "V"), num("frequency", "Frequency", "Hz")] },
          { id: "checklist", title: "Checklist", fields: ck(["Engine oil and filter changed", "Air filter inspected / replaced", "Spark plugs inspected / replaced", "Coolant level and hoses (liquid-cooled)", "Belts inspected", "Battery load-tested, terminals cleaned", "Fuel supply and connections checked for leaks", "Exhaust system inspected", "Wiring and connections inspected", "Enclosure, vents and air intake clear", "Controller alarms and event log reviewed", "Exercise schedule verified", "Transfer switch operation tested", "Run test under load"]) },
          closing() ] },
        serviceForm("Generator Service Report", [num("runHours", "Engine hours", "hrs"), num("batteryVoltage", "Battery voltage", "V")]),
        estimateForm("Generator Sizing Visit"),
      ],
      assign: { pm: "maintenance", repair: "service", install: "service", assess: "estimate", portable: "service" },
    }),
  },
  hvac: {
    name: "HVAC (heating and cooling)",
    equipment: "Equipment", sizeUnit: "Tons",
    fuels: ["Natural gas", "Propane", "Electric", "Oil", "Heat pump"],
    equipmentTypes: ["Furnace", "Air conditioner", "Heat pump", "Boiler", "Ductless mini-split", "Water heater", "HRV / ERV", "Rooftop unit"],
    brands: ["Carrier", "Lennox", "Trane", "Goodman", "Rheem", "York", "Daikin", "Mitsubishi", "Bryant", "Napoleon"],
    jobTypes: { pm: { label: "Tune-up", on: true }, repair: { label: "Service call", on: true }, install: { label: "Installation", on: true }, assess: { label: "Estimate", on: true }, shop: { label: "Shop repair", on: false, board: "Shop repairs" } },
    forms: () => ({
      templates: [
        { id: "heating", name: "Heating tune-up", title: "Heating System Tune-up Report", sections: [
          { id: "readings", title: "Readings", fields: [num("supplyTemp", "Supply air temp", "°C"), num("returnTemp", "Return air temp", "°C"), num("staticPressure", "Total static pressure", "in. w.c."), num("gasPressure", "Manifold gas pressure", "in. w.c."), num("co", "CO in flue", "ppm"), num("blowerAmps", "Blower motor amps", "A")] },
          { id: "checklist", title: "Checklist", fields: ck(["Filter checked / replaced", "Thermostat operation and settings checked", "Burners inspected and cleaned", "Flame sensor cleaned", "Ignitor inspected", "Heat exchanger inspected for cracks", "Venting and flue checked", "Gas connections leak-tested", "Blower wheel and motor inspected", "Condensate drain and trap cleared", "Electrical connections tightened", "Safety controls tested", "CO test performed"]) },
          closing() ] },
        { id: "cooling", name: "Cooling tune-up", title: "Cooling System Tune-up Report", sections: [
          { id: "readings", title: "Readings", fields: [num("supplyTemp", "Supply air temp", "°C"), num("returnTemp", "Return air temp", "°C"), num("suction", "Suction pressure", "psi"), num("head", "Discharge pressure", "psi"), num("superheat", "Superheat", "°F"), num("subcool", "Subcooling", "°F"), num("compAmps", "Compressor amps", "A")] },
          { id: "checklist", title: "Checklist", fields: ck(["Filter checked / replaced", "Outdoor coil cleaned", "Indoor coil inspected", "Refrigerant charge checked", "Capacitor tested", "Contactor inspected", "Condenser fan motor checked", "Condensate drain and pump cleared", "Line set insulation inspected", "Electrical connections tightened", "Thermostat operation checked", "Temperature split within range"]) },
          closing() ] },
        serviceForm("HVAC Service Report", [num("supplyTemp", "Supply air temp", "°C"), num("returnTemp", "Return air temp", "°C")]),
        estimateForm("HVAC Estimate"),
      ],
      assign: { pm: "heating", repair: "service", install: "service", assess: "estimate", portable: "service" },
    }),
  },
  plumbing: {
    name: "Plumbing",
    equipment: "Equipment", sizeUnit: "Gallons",
    fuels: ["Natural gas", "Propane", "Electric", "Tankless gas", "Tankless electric"],
    equipmentTypes: ["Water heater (tank)", "Tankless water heater", "Sump pump", "Water softener", "Backflow preventer", "Well pump", "Boiler"],
    brands: ["Rheem", "A. O. Smith", "Bradford White", "Navien", "Rinnai", "GSW", "Giant", "Zoeller", "Culligan"],
    jobTypes: { pm: { label: "Maintenance", on: true }, repair: { label: "Service call", on: true }, install: { label: "Installation", on: true }, assess: { label: "Estimate", on: true }, shop: { label: "Shop repair", on: false, board: "Shop repairs" } },
    forms: () => ({
      templates: [
        { id: "maintenance", name: "Water heater maintenance", title: "Water Heater Maintenance Report", sections: [
          { id: "readings", title: "Readings", fields: [num("waterTemp", "Hot water temperature", "°C"), num("pressure", "Water pressure", "psi"), num("age", "Unit age", "years")] },
          { id: "checklist", title: "Checklist", fields: ck(["Tank flushed", "Anode rod inspected", "T&P relief valve tested", "Venting checked", "Gas connections leak-tested", "Burner / elements inspected", "Thermostat setting checked", "Expansion tank checked", "Shut-off valves operated", "Visible leaks checked"]) },
          closing() ] },
        serviceForm("Plumbing Service Report", []),
        estimateForm("Plumbing Estimate"),
      ],
      assign: { pm: "maintenance", repair: "service", install: "service", assess: "estimate", portable: "service" },
    }),
  },
  electrical: {
    name: "Electrical",
    equipment: "Equipment", sizeUnit: "Amps",
    fuels: [],
    equipmentTypes: ["Main panel", "Sub-panel", "EV charger", "Standby generator", "Surge protection", "Lighting", "Solar inverter"],
    brands: ["Eaton", "Schneider (Square D)", "Siemens", "Leviton", "ABB", "Generac", "ChargePoint", "Tesla"],
    jobTypes: { pm: { label: "Inspection", on: true }, repair: { label: "Service call", on: true }, install: { label: "Installation", on: true }, assess: { label: "Estimate", on: true }, shop: { label: "Shop repair", on: false, board: "Shop repairs" } },
    forms: () => ({
      templates: [
        { id: "inspection", name: "Electrical inspection", title: "Electrical Inspection Report", sections: [
          { id: "readings", title: "Readings", fields: [num("voltageL1", "Voltage L1–N", "V"), num("voltageL2", "Voltage L2–N", "V"), num("loadAmps", "Measured load", "A"), num("ground", "Ground resistance", "Ω")] },
          { id: "checklist", title: "Checklist", fields: ck(["Panel cover and labelling", "Breakers inspected for heat or damage", "Connections torqued", "Grounding and bonding verified", "GFCI / AFCI devices tested", "Smoke and CO alarms tested", "Surge protection checked", "Visible wiring condition", "Outdoor equipment and disconnects"]) },
          closing() ] },
        serviceForm("Electrical Service Report", []),
        estimateForm("Electrical Estimate"),
      ],
      assign: { pm: "inspection", repair: "service", install: "service", assess: "estimate", portable: "service" },
    }),
  },
  general: {
    name: "General field service",
    equipment: "Equipment", sizeUnit: "",
    fuels: [],
    equipmentTypes: [],
    brands: [],
    jobTypes: { pm: { label: "Maintenance", on: true }, repair: { label: "Service call", on: true }, install: { label: "Installation", on: true }, assess: { label: "Estimate", on: true }, shop: { label: "Shop repair", on: false, board: "Shop repairs" } },
    forms: () => ({
      templates: [
        { id: "maintenance", name: "Maintenance", title: "Maintenance Report", sections: [
          { id: "checklist", title: "Checklist", fields: ck(["Equipment inspected", "Cleaned and serviced", "Safety checks completed", "Operation tested", "Customer walked through findings"]) },
          closing() ] },
        serviceForm("Service Report", []),
        estimateForm("Estimate Visit"),
      ],
      assign: { pm: "maintenance", repair: "service", install: "service", assess: "estimate", portable: "service" },
    }),
  },
};

const s = (v, n) => String(v ?? "").slice(0, n).trim();
const list = (v, n) => (Array.isArray(v) ? v : String(v || "").split(",")).map(x => s(x, 60)).filter(Boolean).slice(0, n);

// The industry settings a business uses (preset + its own edits).
function fromPreset(id) {
  const p = PRESETS[id] || PRESETS.general;
  return { preset: PRESETS[id] ? id : "general", equipment: p.equipment, sizeUnit: p.sizeUnit, fuels: [...p.fuels], equipmentTypes: [...p.equipmentTypes], brands: [...p.brands], jobTypes: JSON.parse(JSON.stringify(p.jobTypes)) };
}
function sanitize(v) {
  const base = fromPreset(v?.preset);
  const jt = {};
  for (const k of ["pm", "repair", "install", "assess", "shop"]) {
    const src = v?.jobTypes?.[k] || {}, def = base.jobTypes[k];
    jt[k] = { label: s(src.label, 40) || def.label, on: k === "pm" || k === "repair" ? true : (src.on === undefined ? def.on : !!src.on) };
    if (k === "shop") jt[k].board = s(src.board, 40) || def.board;
  }
  return { preset: base.preset, equipment: s(v?.equipment, 30) || base.equipment, sizeUnit: s(v?.sizeUnit, 20), fuels: list(v?.fuels ?? base.fuels, 20), equipmentTypes: list(v?.equipmentTypes ?? base.equipmentTypes, 30), brands: list(v?.brands ?? base.brands, 40), jobTypes: jt };
}
const presetList = () => Object.entries(PRESETS).map(([id, p]) => ({ id, name: p.name }));
const presetForms = id => (PRESETS[id] || PRESETS.general).forms();

module.exports = { PRESETS, fromPreset, sanitize, presetList, presetForms };
