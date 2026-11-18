document.addEventListener("DOMContentLoaded", () => {
  console.log("Das relative JavaScript wurde erfolgreich geladen!");
  const statusElem = document.getElementById("status");
  if (statusElem) {
    statusElem.textContent = "✅ JavaScript wurde erfolgreich geladen!";
    statusElem.style.color = "green";
  }
});
