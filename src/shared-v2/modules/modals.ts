// Modals -- SRS FR-13.

export function setupModals(): void {
  document.querySelectorAll('.close-popup').forEach((el) => {
    el.addEventListener('click', () => {
      (document.getElementById('myModal') as HTMLElement).style.display = 'none';
      (document.getElementById('myCapture') as HTMLElement).style.display = 'none';
    });
  });

  (window as any).popup = function (message: string) {
    document.querySelectorAll('.message').forEach((el) => {
      el.innerHTML = message;
    });
    (document.getElementById('myModal') as HTMLElement).style.display = 'block';
  };

  (window as any).capture = function () {
    (document.getElementById('myCapture') as HTMLElement).style.display = 'block';
  };
}
