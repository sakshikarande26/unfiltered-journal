import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Root } from "./Root.js";
import { ProfilePage } from "./pages/ProfilePage.js";
import { ChapterView } from "./pages/ChapterView.js";
import "./styles/tokens.css";
import "./styles/app.css";

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: "/", element: <ProfilePage /> },
      { path: "/chapters/:weekId", element: <ChapterView /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
