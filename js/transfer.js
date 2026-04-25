// js/transfer.js

export const Transfer = (() => {

  const renderFiles = (items = []) => {
    const list = document.getElementById("transferList");

    if (!list) return;

    list.innerHTML = items.map(item => `
      <div class="p-4 border rounded-xl bg-slate-50">
        ${item}
      </div>
    `).join("");
  };

  return {
    renderFiles,
  };

})();